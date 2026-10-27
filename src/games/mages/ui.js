// Mage Siege interface: the world map, team select, in-game HUD (stats, boss bar, shop, wave button, mage details),
// pause and results screens.
// Pure DOM inside the engine's shadow root; it renders what it is told and reports clicks through `on` callbacks.
import { BUILD_BREAK_SECS, ENEMIES, MAGES, MAX_TRAPS, PASSIVES, SPELLS, TICK_HZ, TRAPS, UNLOCKS, secs } from '../../../shared/games/mages/data';
import { magePrice } from '../../../shared/games/mages/combat';
import { totalWaves } from '../../../shared/games/mages/sim';
import { EMBLEM, ICON } from './ui-style';

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
/** What a server refusal means for the player (never the raw reason). */
export function friendlyError(error) {
  return /unknown run/i.test(String(error || '')) ? 'This run expired before it was saved.' : "This run couldn't be verified, so it doesn't count.";
}
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = n => Math.floor(n).toLocaleString('en-US');
/** Boss bar numbers: both rounded up, so a full-health boss never reads more HP than its maximum. */
export const bossHpText = (hp, maxHp) => `${fmt(Math.max(0, Math.ceil(hp)))} / ${fmt(Math.ceil(maxHp))}`;

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
<div class="toast glass" id="toast" role="status" aria-live="polite"></div>
<div class="hold" id="hold" hidden><svg viewBox="0 0 40 40"><circle class="hb" cx="20" cy="20" r="16"/><circle class="hf" cx="20" cy="20" r="16"/></svg></div>`;

/**
 * createUI(rootEl, on) → the screens and HUD. `on` receives the player's choices:
 * exit(), stage(n), endless(), back(), play(team), shop(kind, id), startWave(), speed(), pause(), resume(), quality(name),
 * quit(), sell(), closeInfo(), cancelMode(), result(action: 'retry' | 'next' | 'map' | 'resend'), resendLeftover(), discardLeftover(),
 * reload().
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
    const note = state.note ? `<div class="note glass ${state.note.bad ? 'bad' : ''}">${state.note.busy ? '<span class="spin"></span>' : ''}<span>${esc(state.note.text)}</span>${state.note.discard ? '<button class="btn" id="noteDiscard">Discard</button>' : ''}${state.note.retry ? `<button class="btn" id="noteRetry">${ICON.retry}Retry</button>` : ''}</div>` : '';
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
    const nd = screen.querySelector('#noteDiscard'); if (nd) nd.onclick = () => on.discardLeftover();
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
      set('bossF', Math.round(f * 400), () => { $('bossFill').style.setProperty('--f', f.toFixed(4)); $('bossHp').textContent = bossHpText(boss.hp, boss.maxHp); });
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
   * opts: { mode, stage, won, outcome (local until verified), state: 'verify' | 'waiting' (polling gave up; the server still records it) | 'done' | 'failed' | 'rejected', verify? (0..1),
   * error?, stars?, newUnlocks?: { mages, traps, spells, endless }, score?, best?, rank? }
   */
  function results(o) {
    hud.hidden = true; info.hidden = true;
    modal.hidden = false;
    const endless = o.mode === 'endless', rejected = o.state === 'rejected';
    sheet.className = `sheet glass res ${o.won || endless ? '' : 'lost'}`;
    const title = rejected ? (/unknown run/i.test(String(o.error || '')) ? 'Not saved' : 'Not verified') : endless ? 'Run over' : o.won ? 'Victory' : 'Defeat';
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
    const status = o.state === 'verify'
      ? `<div class="verify"><div class="status"><span class="spin"></span>Verifying your score…</div><div class="vbar"><i id="vfill" style="--f:${(o.verify || 0).toFixed(3)}"></i></div></div>`
      : o.state === 'waiting' ? `<div class="status">${o.mode === 'endless' ? 'Your score will appear on the leaderboard in a minute' : 'Your stars will be saved in a minute'}</div>`
      : o.state === 'failed' ? `<div class="status bad">Couldn't save your result.</div>`
        : rejected ? `<div class="status bad">${esc(friendlyError(o.error))}</div>` : '';
    const canNext = done && !endless && o.won && o.stage < 5;
    const buttons = rejected ? `<button class="btn primary" data-act="map">${ICON.map}World map</button>`
      : o.state === 'failed' ? `<button class="btn" data-act="map">${ICON.map}Later</button><button class="btn primary" data-act="resend">${ICON.retry}Retry</button>`
        : `<button class="btn" data-act="map">${ICON.map}Map</button><button class="btn ${canNext ? '' : 'primary'}" data-act="retry" ${done || o.state === 'waiting' ? '' : 'disabled'}>${ICON.retry}${endless ? 'Again' : 'Retry'}</button>${canNext ? `<button class="btn primary" data-act="next">Next${ICON.next}</button>` : ''}`;
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

  /** Moves the verification bar (0..1) without rebuilding the results card (a rebuild could swallow a click). */
  function verifyProgress(f) {
    const bar = sheet.querySelector('#vfill');
    if (bar) bar.style.setProperty('--f', Math.max(0, Math.min(1, f)).toFixed(3));
  }

  /** A ring that fills under a held finger until the press becomes a long press (details); null hides it. */
  function holdRing(x, y, color) {
    const h = $('hold');
    if (x === null || x === undefined) { h.hidden = true; return; }
    h.style.left = x + 'px'; h.style.top = y + 'px'; h.style.setProperty('--c', color || '#e2b866');
    h.hidden = true; void h.offsetWidth; h.hidden = false; // restart the fill
  }

  return {
    world, team, holdRing, verifyProgress, showHud, hideHud, frame, banner, mageInfo, pause, results, toast, insets,
    get infoOpen() { return !info.hidden; },
    /** Mage portraits (kind → image URL) for the shop, team cards and details; swapped in place, so no screen is rebuilt under a click. */
    setPortraits(map) {
      portraits = { ...map };
      rootEl.querySelectorAll('.pic[data-mage]').forEach(el => { if (portraits[el.dataset.mage]) el.innerHTML = portrait(el.dataset.mage); });
    },
  };
}
