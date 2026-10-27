# Mage Siege (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Mage Siege Phase 1 in 0xHub: a realistic-3D merge tower defense with random terrain maps, 6 mages with levelled passives and tap-cast actives, traps, spells, World 1 (5 stages + Treant boss), Endless mode, account progress and a replay-verified leaderboard.

**Architecture:** A deterministic, DOM-free simulation in `shared/games/mages/` (seeded RNG, 30 Hz integer ticks, actions in, events out) runs in the browser and is replayed by the Worker to verify results. A three.js renderer in `src/games/mages/` draws sim state and reacts to sim events; it never mutates the sim. The Worker stores progress and runs in D1 and records Endless scores through the existing `recordScore`.

**Tech Stack:** TypeScript (shared, worker), plain JS + `.d.ts` for the engine (like `src/games/pool`), three.js 0.128, React 19 page wrapper, Cloudflare Workers + D1, vitest.

**Spec:** `docs/superpowers/specs/2026-10-21-mage-siege-design.md`. Every number in this plan (stats, prices, durations, terrain counts) comes from the spec tables; when a task says "per spec", copy the table value verbatim into `data.ts`.

## Global Constraints

- Simulation code (`shared/games/mages/*` except tests) must not use `Math.random`, `Date`, `performance`, `Math.sin`/`cos`/`tan`/`atan2`/`pow`/`exp`/`log`, DOM, or three.js. Allowed math: `+ - * /`, `Math.sqrt`, `Math.floor`, `Math.min`, `Math.max`, `Math.abs`.
- Fixed tick rate: `TICK_HZ = 30`. All spec durations are seconds in `data.ts` and converted with `secs(n) = Math.round(n * TICK_HZ)`.
- Map is `W = 16`, `H = 9`; tile index = `y * 16 + x`.
- Game id `"mages"`, title "Mage Siege", route `/games/mages`, leaderboard mode `"endless"`, localStorage prefix `0xhubms.`.
- three.js stays at the project's `^0.128.0`; no new runtime dependencies.
- Engine renders inside a shadow root and loads lazily, as Pool does (`src/games/pool/engine.js`, `src/App.tsx:21-22`).
- Landscape only; a phone held upright turns the whole game sideways using Pool's mapping (`src/games/pool/engine.js`, the `rot`/`loc`/`box` helpers in `layout()`).
- Limits: max 20,000 actions per run; Endless cap 300 waves; abandoned runs deleted after 24 h by the daily cron.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. Dropping a mage on a mismatched mage, an occupied tile or the path: the mage must snap back unchanged, never vanish or duplicate. (Task 4 test `rejected actions leave state unchanged`.)
2. Tab hidden or phone locked mid-wave: the game must pause, not fast-forward hundreds of ticks on return. (Task 13 step: pause on `visibilitychange`, cap 8 ticks per frame.)
3. Network failure when submitting a finished run: the result must not be silently lost. The action log stays in localStorage until the server acknowledges it, with a Retry button. (Task 14 step + test of `pendingRun` storage helpers.)
4. Guest-account cleanup cron deleting a guest who has Mage Siege progress but no other games. (Task 10 step: add `mage_progress` to the `NOT EXISTS` list in `worker/db.ts:cleanup`.)
5. Acting with a mage frozen by the Treant's Root Slam (cast, move, sell, merge): must be rejected cleanly, and the UI shows it as stunned. (Task 8 test `root-slammed mage cannot act`.)

---

## File structure

| File | Responsibility |
|---|---|
| `shared/games/mages/rng.ts` | Seeded PRNG |
| `shared/games/mages/data.ts` | All spec tables as typed data, no logic |
| `shared/games/mages/map.ts` | `generateMap(seed)` |
| `shared/games/mages/waves.ts` | Stage wave tables and the Endless wave generator |
| `shared/games/mages/sim.ts` | Sim state, tick loop, actions, economy, lives, waves, enemy movement |
| `shared/games/mages/combat.ts` | Mage targeting, attacks, damage, passives, actives, status effects |
| `shared/games/mages/hazards.ts` | Traps and spells |
| `shared/games/mages/bosses.ts` | Enemy traits, mini-boss and Treant behaviour |
| `shared/games/mages/replay.ts` | Headless replay, state hash, `verifyRun` |
| `shared/games/mages/progress.ts` | Progress shape, start checks, applying results |
| `shared/games/mages/*.test.ts` | Tests per module |
| `migrations/0007_mages.sql` | `mage_progress` |
| `shared/games/mages/chunk.ts` | Sim snapshot/restore, action validation, per-wave advance (Task 9b) |
| `worker/mages.ts` | Progress in D1 and the `MageRun` Durable Object (per-wave verification) |
| `src/games/mages/engine.js` + `engine.d.ts` | Mount, loop, wiring |
| `src/games/mages/scene.js` | Renderer, camera, lights, quality, sideways layout |
| `src/games/mages/terrain.js` | Heightfield, water, lava, props, procedural textures |
| `src/games/mages/units.js` | Mage and enemy figures and animation |
| `src/games/mages/fx.js` | Particles, projectiles, light pool, screen shake, per-element effects |
| `src/games/mages/input.js` | Pointer to tile, drag and tap gestures, sideways mapping |
| `src/games/mages/ui.js` | Screens, HUD, shop, API client, pending-run storage |
| `src/pages/games/Mages.tsx` | Route wrapper |

---

### Task 1: RNG and data tables

**Files:**
- Create: `shared/games/mages/rng.ts`, `shared/games/mages/data.ts`
- Test: `shared/games/mages/data.test.ts`

**Interfaces:**
- Produces:
  - `makeRng(seed: number): Rng` with `Rng = { next(): number /* [0,1) */; int(n: number): number /* 0..n-1 */; pick<T>(a: readonly T[]): T; state(): number }`. Algorithm: mulberry32 on a uint32 state.
  - `TICK_HZ = 30`, `secs(s: number): number`, `W = 16`, `H = 9`.
  - Types: `MageId = "fire"|"ice"|"lightning"|"earth"|"poison"|"wind"`; `EnemyId = "goblin"|"wolf"|"brute"|"bat"|"shaman"|"knight"|"goblinChief"|"direWolf"|"troll"|"witch"|"treant"|"sapling"`; `TrapId = "spike"|"barricade"|"frost"|"mine"`; `SpellId = "meteor"|"freeze"|"surge"`; `BuildTerrain = "grass"|"hill"|"water"|"lava"|"crystal"|"forest"|"well"|"ruins"|"blocked"`; `PathTerrain = "dirt"|"mud"|"ice"|"bridge"`.
  - `MAGES: Record<MageId, MageDef>` where `MageDef = { name: string; dmg: number; aps: number; range: number; splash: number; vsFlying: number; boost: BuildTerrain[]; passive: number[] /* 5 per-level values of the main passive number */; active: number[] /* 5 per-level values of the main active number */; activeTargeted: boolean }`. Main numbers per spec: fire burn % [30,40,50,60,80] and pillars [1..5]; ice slow % [20..40] and blizzard radius [1.5,1.5,1.5,2,2]; lightning chains [2..6] and targets [3,5,7,9,10]; earth armor break [2..6] and quake tiles 3; poison max stacks [3,4,5,6,8]; wind gust % [10,12,14,16,20] and tornado count [1,1,1,1,2]. Secondary per-level values (stun lengths, freeze, explode) live in the same def under named fields added as needed by Tasks 5–6.
  - `LEVEL = { dmg: 1.8, aps: 0.08, range: 0.05 }`, `MAX_LEVEL = 5`, `ACTIVE_CHARGE_SECS = 14`.
  - `ENEMIES: Record<EnemyId, EnemyDef>` with `{ hp, speed, armor, gold, flying: boolean, boss: "mini"|"final"|null, leak: number }` per spec (mini-bosses: ×12 HP, leak 5; treant ×40 HP, armor 6, speed 0.5, leak 999; sapling HP 200, speed 0, leak 0).
  - `TERRAIN_BOOST = { dmg: 0.3, hillRange: 0.25, crystalCharge: 0.2, wellCharge: 0.35, ruinsGold: 0.5, mudSpeed: 0.6, iceSpeed: 1.3 }`.
  - `TRAPS: Record<TrapId, { price; durability; value; secs? }>`, `MAX_TRAPS = 6`, `SPELLS: Record<SpellId, { cost; cooldown; value }>` per spec.
  - `ECON = { startGold: 120, magePrice: 50, priceStep: 10, waveBonus: (w: number) => 20 + 5 * w, sellRate: 0.5 }`, `LIVES = 20`, `STARS = [18, 10, 0]`, `BUILD_BREAK_SECS = 12`, `STAGE_HP = 1.35`, `WAVE_HP = 1.1`, `ENDLESS_WAVE_HP = 1.12`, `TRAP_STAGE_SCALE = 1.25`.
  - `UNLOCKS: { start: Unlock; stages: Record<1|2|3|4|5, Unlock> }` with `Unlock = { mages?: MageId[]; traps?: TrapId[]; spells?: SpellId[]; endless?: true }` per the spec's unlock table.

- [ ] **Step 1: Write the failing tests** in `data.test.ts`:
  - `rng is deterministic`: `makeRng(42)` and another `makeRng(42)` give the same first 100 `next()` values; `makeRng(43)` differs in the first 5.
  - `rng range`: 10,000 `next()` values are all `>= 0 && < 1`; `int(6)` values are all integers in 0..5 and each appears at least once.
  - `every mage has 5-level tables`: for each `MAGES` entry, `passive.length === 5 && active.length === 5`.
  - `spec values`: `MAGES.fire.dmg === 14`, `MAGES.earth.aps === 0.5`, `MAGES.lightning.active` equals `[3,5,7,9,10]`, `ENEMIES.knight.armor === 8`, `TRAPS.mine.price === 70`, `SPELLS.surge.cooldown === 90`, `ECON.waveBonus(3) === 35`.
  - `unlocks cover everything once`: the union of `UNLOCKS.start` and all stages contains each `MageId`, `TrapId` and `SpellId` exactly once.
- [ ] **Step 2: Run** `npx vitest run shared/games/mages/data.test.ts`. Expected: FAIL (modules missing).
- [ ] **Step 3: Implement** `rng.ts` and `data.ts` with the interfaces above.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `git add shared/games/mages && git commit -m "Mage Siege: seeded RNG and spec data tables"`.

### Task 2: Map generation

**Files:**
- Create: `shared/games/mages/map.ts`
- Test: `shared/games/mages/map.test.ts`

**Interfaces:**
- Consumes: `makeRng`, `W`, `H`, terrain types.
- Produces:
  - `type Tile = { kind: "path"; terrain: PathTerrain; order: number } | { kind: "build"; terrain: BuildTerrain }`.
  - `type Prop = { tile: number; type: "tree"|"rock"|"pillar"|"crystal"|"well"|"reed"; turn: number /* 0..3 quarter turns */; scale: number }`.
  - `interface GameMap { seed: number; tiles: Tile[] /* length 144 */; path: number[] /* tile indices entry→exit */; props: Prop[] }`.
  - `generateMap(seed: number): GameMap`.
  - `pathPoint(map: GameMap, d: number): { x: number; y: number }`: tile-centre polyline interpolation at distance `d` tiles from the entry (centre of tile `(x, y)` is `(x + 0.5, y + 0.5)`); clamps to the ends.
  - `pathLength(map: GameMap): number` (= `path.length - 1`).

Path algorithm (the tests don't determine it): start at a random row on `x = 0`; repeatedly step right, up or down (never left), weighting right at 0.5, choosing only moves that keep the path non-self-touching (a candidate may share an edge only with the current tile) and stay in bounds; stop at `x = 15`. Reject and retry (same RNG, continuing) if length is outside 34–48. Then place terrain from the spec counts: water lake (2+ connected tiles; if the path crosses a water-adjacent stretch, turn one path tile into `bridge` over it), mud stretch 2–3, ice patch 0–1 stretches of 2, hills 2, lava 1, crystal 1, forest 3, well 1, ruins 1, blocked 6–12, grass for the rest. Retry if fewer than 40 build (non-blocked) tiles, or fewer than 24 of them border the path.

- [ ] **Step 1: Write the failing tests:**
  - `500 seeds produce valid maps`: for seeds 1..500, the path starts at `x = 0`, ends at `x = 15`, length is in 34..48 tiles, consecutive tiles share an edge, no two non-consecutive path tiles share an edge, and `tiles[i].kind === "path"` exactly for the path tiles.
  - `guaranteed terrain`: each map has ≥2 hill, ≥2 water, ≥1 lava, ≥1 crystal, ≥3 forest, ≥1 well, ≥1 ruins, blocked count in 6..12, ≥40 buildable non-blocked tiles, ≥24 of them edge-adjacent to the path, exactly 1 mud stretch of 2–3 tiles.
  - `same seed same map`: `generateMap(7)` deep-equals `generateMap(7)`; `generateMap(8)` has a different path.
  - `pathPoint interpolates`: `pathPoint(m, 0)` equals the first tile's centre, `pathPoint(m, 0.5)` is halfway between the first two centres, and `pathPoint(m, 1e9)` equals the last tile's centre.
- [ ] **Step 2: Run** `npx vitest run shared/games/mages/map.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `map.ts`. Props: trees on forest and some grass, rocks on blocked, a pillar on ruins, a crystal on crystal, a well on well, reeds on water edges. `turn` and `scale` come from the RNG.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `"Mage Siege: random terrain map generation"`.

### Task 3: Simulation core (waves, movement, lives, economy)

**Files:**
- Create: `shared/games/mages/sim.ts`, `shared/games/mages/waves.ts`
- Test: `shared/games/mages/sim.test.ts`

**Interfaces:**
- Consumes: Tasks 1–2.
- Produces (later tasks extend these types; keep them in `sim.ts`):
  - `interface SimConfig { seed: number; mode: "stage"|"endless"; stage: 1|2|3|4|5; team: MageId[]; traps: TrapId[]; spells: SpellId[] }`.
  - `type Action = { t: number } & ({ type: "place"; mage: MageId; tile: number } | { type: "merge"; from: number; to: number } | { type: "move"; from: number; to: number } | { type: "sell"; tile: number } | { type: "cast"; tile: number; target?: number } | { type: "trap"; trap: TrapId; tile: number } | { type: "spell"; spell: SpellId; target?: number } | { type: "startWave" })`. `place` buys and places in one action (the UI's shop tap then tile tap produces it).
  - `interface Enemy { id: number; kind: EnemyId; hp: number; maxHp: number; armor: number; d: number /* tiles along path */; speed: number; status: Status; gold: number }` with `Status = { slow: number; slowT: number; stunT: number; freezeT: number; burnDps: number; burnT: number; poison: { stacks: number; dps: number; t: number }; shieldT: number; noHealT: number }`.
  - `interface Mage { id: number; kind: MageId; level: 1|2|3|4|5; tile: number; cd: number; charge: number /* 0..1 */; hits: number; stunT: number; spent: number }`.
  - `interface Sim { cfg: SimConfig; map: GameMap; rng: Rng; tick: number; phase: "build"|"wave"|"won"|"lost"; wave: number; breakT: number; gold: number; lives: number; purchases: number; mages: Mage[]; enemies: Enemy[]; spawnQueue: { tick: number; kind: EnemyId }[]; nextId: number; rejected: number; kills: number; /* + traps, spells, zones added in later tasks */ }`.
  - `type SimEvent = { type: "spawn"; enemy: number } | { type: "leak"; enemy: number; lives: number } | { type: "kill"; enemy: number; by: number | null; gold: number } | { type: "waveStart"; wave: number } | { type: "waveEnd"; wave: number; bonus: number } | { type: "end"; won: boolean }`. Later tasks add variants.
  - `createSim(cfg: SimConfig): Sim`, `step(sim: Sim, actions: Action[]): SimEvent[]` (advances exactly one tick; applies the actions whose `t === sim.tick` first), `applyAction(sim: Sim, a: Action, ev: SimEvent[]): boolean`, `totalWaves(sim: Sim): number` (10, or 300 for Endless), `stars(sim: Sim): 0|1|2|3`.
  - Test hook: `spawnForTest(sim: Sim, kind: EnemyId, d?: number): Enemy`.
  - `waves.ts`: `type Group = { kind: EnemyId; count: number; every: number /* secs */; delay: number /* secs */ }`; `STAGE_WAVES: Record<1|2|3|4|5, Group[][]>` (10 waves each, enemy introduction order per spec, wave 10 of stages 1–4 includes the stage's mini-boss and stage 5's includes the treant); `endlessWave(wave: number, rng: Rng): Group[]` (mix widens with wave; every 10th wave adds a boss cycling goblinChief → direWolf → troll → witch → treant).

Rules to implement: phase `build` until `startWave` (wave 1) or until `breakT` reaches 0 (12 s after each wave); enemies spawn from the queue at `d = 0`, move `speed × terrainFactor / TICK_HZ` tiles per tick (mud 0.6, ice 1.3, flyers ignore terrain), leak when `d >= pathLength`; HP = base × `STAGE_HP^(stage-1)` × `WAVE_HP^(wave-1)` (Endless: `ENDLESS_WAVE_HP^(wave-1)`); a wave ends when its queue is empty and no enemies are alive, paying `waveBonus(wave)`; lives ≤ 0 → `lost`; the last stage wave cleared → `won`.

- [ ] **Step 1: Write the failing tests:**
  - `starts in build with 120 gold and 20 lives`.
  - `startWave spawns wave 1`: after `startWave` at t=0 and stepping until a `spawn` event, `phase === "wave"`.
  - `goblin crosses the map`: a test-spawned goblin on a map with no mud or ice leaks after `pathLength / 1.0 * 30` ticks (±1) and costs 1 life.
  - `mud slows`: a goblin's `d` advance over 30 ticks on a mud tile is 0.6 (±0.01).
  - `flyers ignore mud`: a bat advances 1.3 over 30 ticks on mud.
  - `HP scaling`: a stage-3 wave-4 goblin has `40 × 1.35^2 × 1.1^3` HP (±0.01).
  - `wave end pays bonus and opens a 12 s break`.
  - `lives reaching 0 loses`; `leaking a mini-boss costs 5`.
  - `clearing wave 10 wins`: using `spawnForTest` and direct `hp = 0` kills, the sim reaches `won` with `stars()` 3 at 20 lives, 2 at 12, 1 at 3.
  - `endless waves have bosses every 10th`: `endlessWave(10)` contains goblinChief, `endlessWave(50)` contains treant.
- [ ] **Step 2: Run** `npx vitest run shared/games/mages/sim.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `sim.ts` and `waves.ts`.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `"Mage Siege: simulation core with waves, movement, lives and economy"`.

### Task 4: Mages: buy, place, merge, move, sell, basic attacks, terrain boosts

**Files:**
- Create: `shared/games/mages/combat.ts`
- Modify: `shared/games/mages/sim.ts` (call `combatTick` from `step`; implement the `place/merge/move/sell` cases of `applyAction`)
- Test: `shared/games/mages/mages.test.ts`

**Interfaces:**
- Consumes: Task 3.
- Produces:
  - `magePrice(sim: Sim): number` (= 50 + 10 × purchases).
  - `mageStats(sim: Sim, m: Mage): { dmg: number; aps: number; range: number; chargeRate: number /* per tick */ }`, applying level scaling, terrain boosts (+30% dmg on a matching boost tile, +25% range on hill, charge +20% on crystal, +35% on well) and per-level growth.
  - `damage(sim: Sim, e: Enemy, amount: number, by: Mage | null, ev: SimEvent[]): void`: subtracts `max(1, amount - armor)`, ×1.5 if frozen and an ice L5 mage exists (Task 5 sets the flag), ×0.5 if shielded; on death emits `kill`, adds gold (+50% if `by` stands on ruins), increments `kills`.
  - `combatTick(sim: Sim, ev: SimEvent[]): void`: each mage whose `cd` is 0 and `stunT` is 0 targets the enemy with the highest `d` within range (Euclidean distance between the tile centre and `pathPoint`), deals `dmg` (+25% vs flying for lightning; fire splash 0.6 tiles), emits `{ type: "attack"; mage: number; enemy: number }`, resets `cd = round(TICK_HZ / aps)`. Charge grows by `chargeRate` every tick up to 1.
  - New events: `attack`, `{ type: "place"; mage: number }`, `{ type: "merge"; mage: number; level: number }`, `{ type: "sell"; tile: number; refund: number }`.

- [ ] **Step 1: Write the failing tests:**
  - `place costs 50 then 60`: two `place` actions leave `gold === 120 - 50 - 60` and two mages.
  - `place rejects path, blocked, occupied, unaffordable, not-in-team tiles or mages`: each returns false, increments `rejected` and changes nothing else.
  - `rejected actions leave state unchanged` (Review Focus 1): a deep clone of `sim.mages` and `sim.gold` before an illegal `merge` (fire L1 onto ice L1) and `move` onto an occupied tile equals the state after.
  - `merge`: two fire L1 → one fire L2 on the `to` tile; `spent` is the sum of both. Fire L1 onto fire L2 is rejected; L5 onto L5 is rejected.
  - `move` to an empty buildable tile succeeds and keeps level and charge.
  - `sell refunds half of spent`: a merged L2 (spent 110) refunds 55.
  - `level scaling`: L3 fire `dmg === 14 × 1.8^2` and `aps === 1.0 × (1 + 0.08 × 2)`.
  - `terrain`: a fire mage on lava has `dmg` ×1.3, any mage on a hill has range ×1.25, a mage on a well charges 1.35× faster.
  - `attacks the frontmost enemy in range`, `respects attack speed` (an earth mage hits twice in 120 ticks against a static sapling), `armor floors at 1`.
  - `ruins gold`: a kill by a mage on ruins gives `floor(gold × 1.5)`.
- [ ] **Step 2: Run** `npx vitest run shared/games/mages/mages.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** in `combat.ts` and wire it into `sim.ts`.
- [ ] **Step 4: Run** all mages tests: `npx vitest run shared/games/mages`. Expected: PASS.
- [ ] **Step 5: Commit** `"Mage Siege: mages, merging, attacks and terrain boosts"`.

### Task 5: Passives

**Files:**
- Modify: `shared/games/mages/combat.ts`, `shared/games/mages/data.ts` (secondary per-level fields)
- Test: `shared/games/mages/passives.test.ts`

**Interfaces:**
- Consumes: Task 4's `damage`, `combatTick`, `Status`.
- Produces: `statusTick(sim: Sim, ev: SimEvent[]): void` (burn and poison damage, timers, slow) called from `step`; event `{ type: "passive"; mage: number; kind: "burn"|"burnSpread"|"explode"|"chill"|"freeze"|"shatter"|"chain"|"armorBreak"|"quake"|"venom"|"venomJump"|"gust"; targets: number[] }`.

Per-spec behaviour to implement, all keyed by mage level:
- Fire *Burn*: on hit set `burnDps = hitDmg × [0.3,0.4,0.5,0.6,0.8][L-1]` for 3 s. L3+: on a burning enemy's death, burn spreads to enemies within 1 tile. L5: also an explosion of 100% hit damage within 1 tile.
- Ice *Chill*: slow `[0.2,0.25,0.3,0.35,0.4]` for 2 s. L3+: every 5th hit freezes for 1 s. L5: frozen enemies take +50% from all sources.
- Lightning *Chain*: every 3rd attack (every attack at L5) chains to `[2..6]` extra enemies within 1.5 tiles of the previous target, each jump 70% of the previous damage, never hitting the same enemy twice.
- Earth *Armor Break*: −`[2..6]` armor per hit, floor 0. L5: a quake for 40% damage within 0.8 tiles.
- Poison *Venom*: +1 stack per hit up to `[3,4,5,6,8]`; each stack deals `4 × level` dps for 4 s, refreshed on hit. L5: on death, stacks jump to the nearest enemy within 1.5 tiles.
- Wind *Gust*: chance `[0.10..0.20]` (sim RNG) to push the target back 0.5 tiles (1 at L5); bosses (`ENEMIES[k].boss !== null`) are immune.

- [ ] **Step 1: Write the failing tests**, one per behaviour above with the exact numbers: `fire burn dps by level`, `fire L3 spreads burn on death`, `fire L5 explodes`, `ice slow by level`, `ice L3 freezes every 5th hit`, `ice L5 frozen takes 1.5x`, `lightning chains every 3rd attack with 70% falloff`, `lightning L5 chains every attack`, `chain never repeats a target`, `earth strips armor to floor 0`, `earth L5 quake`, `poison stacks cap by level`, `poison dps is 4×level per stack`, `poison L5 jumps on death`, `wind gust pushes back with seeded chance (exact count over 1000 hits with seed 1 matches a recorded value)`, `bosses ignore knockback`.
- [ ] **Step 2: Run** `npx vitest run shared/games/mages/passives.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run shared/games/mages`. Expected: PASS.
- [ ] **Step 5: Commit** `"Mage Siege: mage passives for all six mages"`.

### Task 6: Active skills

**Files:**
- Modify: `shared/games/mages/combat.ts`, `shared/games/mages/sim.ts` (the `cast` action), `shared/games/mages/data.ts`
- Test: `shared/games/mages/actives.test.ts`

**Interfaces:**
- Consumes: Tasks 4–5.
- Produces:
  - `castActive(sim: Sim, m: Mage, target: number | undefined, ev: SimEvent[]): boolean`. Rejects if `charge < 1`, `stunT > 0`, or a targeted skill gets no path-tile target. On success, sets `charge = 0`.
  - `Zone = { id: number; kind: "lava"|"blizzard"|"plague"|"charged"|"wall"|"tornado"; d: number /* path position */; r: number; t: number; level: number; owner: number }`, stored in `sim.zones`, advanced by `zoneTick(sim, ev)`.
  - Event `{ type: "cast"; mage: number; skill: MageId; level: number; target?: number; hits: number[] }`.

Per spec, by level: Fire *Flame Pillars* (targeted): `[1..5]` pillars on path tiles centred on the target, 300% hit damage each; L5 leaves `lava` zones for 5 s. Ice *Blizzard* (targeted): radius `[1.5,1.5,1.5,2,2]`, 4 s, slow 50%, 60% hit dmg/s; L5 freezes everything inside for 2 s on start. Lightning *Thunder Stun* (instant): the `[3,5,7,9,10]` frontmost enemies within 2× range take 250% and are stunned `[1,1.4,1.8,2.2,2.5]` s; L5 leaves `charged` zones for 4 s. Earth *Earthquake* (targeted): 3 path tiles, 200% damage, 1.2 s stun; L5 adds a `wall` zone blocking ground enemies for 3 s. Poison *Plague Cloud* (targeted): r 1.5, 5 s, +1 stack/s, sets `noHealT`; L5 the zone's `d` follows the frontmost enemy inside it. Wind *Tornado* (instant): moves from the exit back along the path for 3 s, pulls touched ground enemies back up to 2 tiles, 100% dmg/s; L5 spawns a second one 1 s later. Mini-bosses and the treant take half-length stuns and freezes.

- [ ] **Step 1: Write the failing tests:** `cast rejected until fully charged`, `charge takes 14 s base and less on a well`, `cast resets charge`, one test per mage at L1 and at L5 asserting the spec numbers above (`fire pillars count and lava at L5`, `blizzard radius and L5 freeze`, `thunder target count and stun length`, `thunder L5 charged ground`, `earthquake stun and L5 wall blocks ground but not bats`, `plague blocks shaman healing and L5 follows enemies`, `tornado pulls back max 2 tiles and L5 has two`), and `bosses get half stun`.
- [ ] **Step 2: Run** `npx vitest run shared/games/mages/actives.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run shared/games/mages`. Expected: PASS.
- [ ] **Step 5: Commit** `"Mage Siege: tap-to-cast active skills"`.

### Task 7: Traps and spells

**Files:**
- Create: `shared/games/mages/hazards.ts`
- Modify: `shared/games/mages/sim.ts` (`trap` and `spell` actions; call `hazardTick`)
- Test: `shared/games/mages/hazards.test.ts`

**Interfaces:**
- Consumes: Tasks 3–6.
- Produces:
  - `Trap = { id: number; kind: TrapId; tile: number; dur: number }` in `sim.traps`; `spellCd: Record<SpellId, number>` in `sim`.
  - `placeTrap(sim, kind, tile, ev): boolean`, `castSpell(sim, kind, target, ev): boolean`, `hazardTick(sim, ev): void`.
  - Events: `{ type: "trapPlace"; trap: number }`, `{ type: "trapTrigger"; trap: number; enemies: number[] }`, `{ type: "trapBreak"; trap: number }`, `{ type: "spell"; spell: SpellId; target?: number }`.

Rules per spec: traps go only on path tiles with no trap, max 6, must be unlocked (in `cfg.traps`) and affordable. Spike: 20 × `1.25^(stage-1)` to each ground enemy entering the tile, −1 durability per enemy, durability 30. Barricade: ground enemies stop at it and deal 1 durability per enemy per second, durability 40. Frost Rune: 40% slow for 2 s, −1 per enemy, durability 40. Blast Mine: 150 × `1.25^(stage-1)` within 1 tile, single use. Brutes deal 3× durability damage and detour to attack traps within 1 tile. Flyers ignore all traps. Meteor (80 gold, 30 s cooldown): 400 × `1.35^(stage-1)` within 1.2 tiles of the target. Time Freeze (120, 60 s): freeze all enemies 3 s (bosses 1.5 s). Mana Surge (150, 90 s): every mage `charge = 1`.

- [ ] **Step 1: Write the failing tests:** `trap only on empty path tiles`, `max 6 traps`, `locked trap rejected`, `spike damage and durability`, `barricade blocks then breaks after 40 enemy-seconds`, `brute deals 3x durability`, `frost rune slows`, `mine is single use`, `bats ignore traps`, `meteor damage scales by stage`, `spell cooldown rejects recast`, `spell needs gold`, `time freeze halves on bosses`, `mana surge fills every charge`.
- [ ] **Step 2: Run** `npx vitest run shared/games/mages/hazards.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run shared/games/mages`. Expected: PASS.
- [ ] **Step 5: Commit** `"Mage Siege: traps with durability and spells"`.

### Task 8: Enemy traits, mini-bosses and the Ancient Treant

**Files:**
- Create: `shared/games/mages/bosses.ts`
- Modify: `shared/games/mages/sim.ts` (call `enemyAbilities` each tick)
- Test: `shared/games/mages/bosses.test.ts`

**Interfaces:**
- Consumes: Tasks 3–7.
- Produces: `enemyAbilities(sim: Sim, ev: SimEvent[]): void`; event `{ type: "bossSkill"; enemy: number; skill: "summon"|"sprint"|"regen"|"shield"|"heal"|"saplings"|"rootSlam"; targets: number[] }`; `Mage.stunT` is used by Root Slam.

Per spec: Shaman heals enemies within 1.5 tiles for 8% max HP every 3 s (blocked while `noHealT > 0`). Goblin Chief calls 4 goblins every 6 s at its position. Dire Wolf sprints at 2× for 2 s every 8 s. Troll regenerates 1%/s unless burning or poisoned. Witch shields enemies within 2 tiles for 3 s every 7 s (50% damage taken). Treant: plants 3 saplings on path tiles ahead of it every 10 s; heals 2% max HP per second per living sapling; Root Slam every 15 s stuns the 3 mages nearest it for 3 s; below 50% HP it moves 30% faster; leaking ends the run.

- [ ] **Step 1: Write the failing tests:** `shaman heals 8% every 3 s`, `plague blocks shaman heal`, `chief summons 4 goblins every 6 s`, `dire wolf sprint doubles speed for 2 s`, `troll regen stops while burning`, `witch shield halves damage`, `treant plants 3 saplings every 10 s`, `saplings heal treant 2% per second each`, `root slam stuns the 3 nearest mages for 3 s`, `root-slammed mage cannot act` (Review Focus 5: `cast`, `move`, `sell` and `merge` involving that mage are rejected while `stunT > 0`), `treant enrages under 50%`, `treant leak loses the run`.
- [ ] **Step 2: Run** `npx vitest run shared/games/mages/bosses.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run shared/games/mages`. Expected: PASS.
- [ ] **Step 5: Commit** `"Mage Siege: enemy traits, mini-bosses and the Ancient Treant"`.

### Task 9: Replay, determinism, run verification and progress rules

**Files:**
- Create: `shared/games/mages/replay.ts`, `shared/games/mages/progress.ts`
- Test: `shared/games/mages/replay.test.ts`, `shared/games/mages/progress.test.ts`

**Interfaces:**
- Consumes: everything in `shared/games/mages`.
- Produces:
  - `hashSim(sim: Sim): number`: FNV-1a over tick, phase, wave, gold, lives, and every mage, enemy (hp rounded to 1e-6), trap and zone, in array order.
  - `interface Outcome { won: boolean; wavesCleared: number; lives: number; stars: 0|1|2|3; score: number /* endless: wavesCleared*100 + lives; stage: 0 */; ticks: number }`.
  - `replay(cfg: SimConfig, actions: Action[], maxTicks?: number): { outcome: Outcome; rejected: number; finished: boolean }`. Stops at `won`/`lost`, at `maxTicks`, or when Endless reaches 300 waves. While in `build` with no further `startWave` actions, auto-start follows the 12 s break rule.
  - `verifyRun(cfg: SimConfig, actions: unknown): { ok: true; outcome: Outcome } | { ok: false; error: string }`. Rejects non-arrays, more than 20,000 actions, malformed actions (unknown type, non-integer `t`, out-of-range tiles), `t` not non-decreasing, any action rejected by the sim, and games that don't finish within `maxTicks` (= 10 stage waves or 300 Endless waves of maximum length, computed as `totalWaves × 120 s × 30`).
  - `progress.ts`: `interface Progress { cleared: Partial<Record<1|2|3|4|5, 1|2|3>>; endlessBest: number }`. Unlocks are derived, not stored: `unlocked(p: Progress): { mages: MageId[]; traps: TrapId[]; spells: SpellId[]; endless: boolean; stages: number[] }` from `UNLOCKS` and `p.cleared`. `checkStart(p: Progress, mode, stage, team: unknown): string | null` returns an error message or null: the stage must be unlocked, team must be 1–5 distinct unlocked mages, and it must be exactly 5 when 5+ are unlocked. `applyOutcome(p: Progress, mode, stage, o: Outcome): Progress` keeps the best stars and the best Endless score.
  - `pendingRun` helpers live in Task 14, not here.

- [ ] **Step 1: Write the failing tests:**
  - `replay is deterministic`: a scripted 10-wave stage-1 game (place 3 fire mages, merges, casts, traps, a meteor) replayed twice gives equal `hashSim` after every `waveEnd`.
  - `different seed different result`: the same actions with another seed give a different final hash, or are rejected for an illegal tile.
  - `scripted run wins stage 1 with 3 stars`: a strong scripted script clears stage 1. This doubles as an early balance smoke test, so tune `waves.ts` if it fails for balance reasons.
  - `verifyRun rejects`: unsorted `t`, 20,001 actions, an unknown action type, merging mismatched mages, placing a mage not in the team, casting an uncharged skill, and an unfinished game, each with `ok: false`.
  - `verifyRun accepts` the scripted win and returns its outcome.
  - `endless score`: a scripted Endless loss after clearing 7 waves with 4 lives scores 704.
  - `progress`: a fresh progress unlocks Fire/Ice/Lightning, Spike and Meteor, and only stage 1; clearing stage 2 unlocks Earth and stage 3; `checkStart` rejects stage 3 on fresh progress, a locked mage, duplicates, and 4 mages when 6 are unlocked; `applyOutcome` keeps the max stars.
- [ ] **Step 2: Run** `npx vitest run shared/games/mages/replay.test.ts shared/games/mages/progress.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `replay.ts` and `progress.ts`.
- [ ] **Step 4: Run** `npx vitest run shared/games/mages`. Expected: PASS.
- [ ] **Step 5: Measure replay cost.** Add a test `endless replay cost` that replays a scripted 100-wave Endless run (a strong script, or a test-only god mode enabled by `cfg` flag `__noLeak` that is rejected by `verifyRun`) and logs elapsed ms. Run it and record the number in the commit message. Decision rule: if 300 waves extrapolate to under 500 ms on this machine, keep single-request verification. Otherwise, split finish into chunked verification: the client sends actions per 25 waves and `mage_runs` stores a checkpoint hash and serialized sim state. Add that as an extra task before Task 10 and tell the user.
- [ ] **Step 6: Commit** `"Mage Siege: replay verification and progress rules (endless 100-wave replay: N ms)"`.

### Task 9b: Faster sim and incremental verification (added by ruling R26)

Task 9 measured a 100-wave Endless replay at 7.2–8.3 s (300 waves ≈ 25–31 s) and a stage-1 verify at ≈76 ms, so whole-run verification in one request is ruled out. This task makes the sim faster and lets the server verify a run wave by wave while it is played, following the existing Tetris `EndlessRun` Durable Object (`worker/endless.ts`: `init`, `input` with `upTo`, wall-clock check, hash compare, `serialize`/`deserialize`, abandon alarm).

**Files:**
- Modify: `shared/games/mages/sim.ts`, `combat.ts`, `actives.ts`, `hazards.ts`, `bosses.ts` (performance only), `rng.ts` (restore from state), `replay.ts`
- Create: `shared/games/mages/chunk.ts`
- Test: `shared/games/mages/chunk.test.ts`, existing replay tests

**Interfaces:**
- Consumes: Task 9 `verifyRun` validation, `hashSim`, `Outcome`, `replay`.
- Produces:
  - `restoreRng(state: number): Rng` (resumes from `rng.state()`).
  - `serializeSim(sim: Sim): SimSnapshot` (plain JSON, RNG states as numbers, no functions) and `restoreSim(snap: SimSnapshot): Sim`, such that `hashSim(restoreSim(serializeSim(s))) === hashSim(s)` and stepping both gives identical hashes from then on.
  - `validateActions(raw: unknown, fromTick: number, upTo: number, max: number): Action[] | string` (Task 9's validation, now shared by `verifyRun`).
  - `advance(sim: Sim, actions: Action[], upTo: number): { ok: true } | { ok: false; error: string }`: steps from `sim.tick` to `upTo` (exclusive), feeding each tick its actions. Any sim rejection fails. `upTo` may not exceed the tick at which the current wave (or build phase) began plus `secs(150)` (one chunk is at most one wave plus its break), nor run past the end of the game.
  - `outcomeOf(sim: Sim): Outcome` (shared by `replay` and the server).

**Performance:** profile the 100-wave cost test. Remove per-tick allocations in hot paths (array `filter`/`map` copies in targeting, status, zone and hazard loops; repeated `pathPoint` for the same enemy within a tick, which can be cached per tick). Behaviour must not change: pin `hashSim` after every `waveEnd` for the Task 9 scripted stage-1 run and the first 30 waves of the cost run BEFORE optimising, and assert the same sequence after. Target: at least 3× faster on the 100-wave test. Report before and after numbers.

- [ ] **Step 1: Write failing tests** in `chunk.test.ts`: `serialize round-trip keeps the hash and the future`; `advance in per-wave chunks equals one replay` (scripted stage-1 run fed chunk by chunk with serialize → JSON → restore between chunks; the final `outcomeOf` deep-equals `replay(...).outcome`); `advance rejects upTo past one wave plus 150 s`; `advance rejects stale or out-of-range actions`; `per-wave hash sequence is pinned` (recorded before optimising).
- [ ] **Step 2: Run** `npx vitest run shared/games/mages/chunk.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** RNG restore, serialize/restore, `validateActions`, `advance` and `outcomeOf`; refactor `replay`/`verifyRun` onto them.
- [ ] **Step 4: Optimise**; re-run the pinned-hash and cost tests; record the numbers.
- [ ] **Step 5: Run** `npx vitest run shared/games/mages && npm run typecheck`. Expected: PASS.
- [ ] **Step 6: Commit** `"Mage Siege: faster sim and per-wave verification chunks (100-wave: A ms → B ms)"`.

### Task 10: Server: progress table, MageRun Durable Object, API, leaderboard (revised by ruling R26)

**Files:**
- Create: `migrations/0007_mages.sql`, `worker/mages.ts` (progress helpers + the `MageRun` Durable Object)
- Modify: `worker/index.ts` (routes near the other verified runs, ~line 338–430, and the `/api/leaderboard` switch ~line 357; export `MageRun`), `wrangler.jsonc` (binding `MAGE_RUN`, class `MageRun`, migration tag `v5` with `new_sqlite_classes: ["MageRun"]`), `worker/env.ts` (binding type), `worker/db.ts:344-362` (`cleanup`), `shared/protocol.ts:210-211` (`GameId`, `GAME_IDS`)

**Interfaces:**
- Consumes: `checkStart`, `applyOutcome`, `unlocked`, `createSim`, `serializeSim`/`restoreSim`, `validateActions`, `advance`, `outcomeOf`, `hashSim`, `recordScore(db, userId, "mages", "endless", score, durationMs, data)`, `topScores(db, "mages", "endless")`, `requireUser`, `body`, `limit`, `json`, `err`, `clearStorage`; pattern: `worker/endless.ts`.
- Produces:
  - SQL: `CREATE TABLE mage_progress (user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, data TEXT NOT NULL, updated_at INTEGER NOT NULL)`.
  - `getProgress(db, userId): Promise<Progress>`, `saveProgress(db, userId, p): Promise<void>`.
  - `class MageRun extends DurableObject<Env>` with `init(userId, cfg: SimConfig): Promise<{ seed: number }>` (server-chosen seed; stores the serialized sim) and `input(userId, batch: { upTo: number; actions: unknown; h: number; final?: boolean }): Promise<MageChunkResult>`.
  - `input` behaviour: load and restore; check owner, done and invalid; reject `upTo` ahead of real time (the game may run at 2× speed, so allow `upTo / TICK_HZ * 1000 <= 2 * (now - createdAt) + 3000`); `validateActions` then `advance`; compare `batch.h` with `hashSim` (mismatch marks the run invalid); save. When the sim is won or lost (or `final` on an Endless run), record: stage runs go through `applyOutcome` + `saveProgress`; Endless runs go through `recordScore` and update `endlessBest`; then clear storage and return `{ ok, finished: true, outcome, progress, best?, rank? }`. Abandon alarm 1 h, like EndlessRun.
  - Routes: `GET /api/mages/progress` → `{ progress, unlocked }`; `POST /api/mages/start {mode, stage, team}` → `{ runId, seed, cfg }` (checkStart against stored progress; rate limit `run-start:${id}`, 300/hour); `POST /api/mages/runs/:id/input` (body limit 2,000,000) → `MageRun.input`. `/api/leaderboard?game=mages&mode=endless` → `topScores`.
  - Client contract (used by Task 14): post one `input` per completed wave (`upTo` = the tick right after that wave's `waveEnd`), and a final one when the run ends (won/lost, or quitting Endless).

- [ ] **Step 1: Write the migration, `worker/mages.ts`, the binding and migration in `wrangler.jsonc`, the routes and the leaderboard case;** add `"mages"` to `GameId`/`GAME_IDS`.
- [ ] **Step 2: Cleanup:** in `worker/db.ts:cleanup`, add `AND NOT EXISTS (SELECT 1 FROM mage_progress m WHERE m.user_id = users.id)` to the guest delete (Review Focus 4). Abandoned runs expire through the DO alarm.
- [ ] **Step 3: Verify:** `npm run typecheck && npm test`. Expected: pass.
- [ ] **Step 4: Verify the API locally:** `npm run dev`; as a guest: start stage 3 → 400 locked; start stage 1 with `["fire","ice","lightning"]` → seed; drive the Task 9 scripted stage-1 player for that seed in a small Node script, posting one `input` per wave → the final response has `finished: true`, `outcome.won` and `progress.cleared[1] === 3`; a tampered batch (wrong `h`) → 400 and the run is dead; `GET /api/mages/progress` shows stage 2 unlocked.
- [ ] **Step 5: Commit** `"Mage Siege: progress and wave-by-wave verified runs on the server"`.

### Task 11: 3D scene, terrain and quality settings

**Files:**
- Create: `src/games/mages/engine.js`, `src/games/mages/engine.d.ts`, `src/games/mages/scene.js`, `src/games/mages/terrain.js`
- Create: `src/pages/games/Mages.tsx`; Modify: `src/App.tsx` (lazy route next to Pool at lines 21-22 and 54)

**Interfaces:**
- Consumes: `generateMap`, `pathPoint`, `GameMap`.
- Produces:
  - `engine.d.ts`: `export function mountMages(host: HTMLElement, opts: { onExit: () => void; api: MagesApi }): () => void` with `MagesApi = { progress(): Promise<unknown>; start(body: unknown): Promise<unknown>; input(runId: string, batch: unknown): Promise<unknown> }`.
  - `scene.js`: `createScene(canvas, rootEl, quality) → { renderer, scene, camera, layout(hudRects), toWorld(tileIndex) → THREE.Vector3, tileAt(clientX, clientY) → number | -1, loc(e), setQuality(q), render(), dispose() }`. Camera tilted ~55°, framing the 16 × 9 board between HUD rects; sideways mode for upright touch screens (copy Pool's `rot`/`loc`/`box` approach, including the swapped `--sa-*` safe-area variables).
  - `terrain.js`: `buildTerrain(scene, map, quality) → { group, update(dt), dispose() }`: a heightfield (hills raised, path sunken 0.04, water basin), PBR materials from procedural canvas textures (grass, dirt, stone, sand, moss) memoized like Pool's `memo`; water shader with ripple and environment reflection (High only); lava with pulsing emissive; props from `map.props` (lathe and extrude trees, rocks, pillars, crystals, wells, reeds); tile hover/boost highlight overlay `setHighlight(tiles: number[], color)`.
  - Quality: `"high"|"medium"|"low"` stored as `0xhubms.quality`; auto-picked on first run (low if `devicePixelRatio × screen area` is small or `navigator.hardwareConcurrency <= 4` on a touch device). Low: no shadows, no water reflection, pixel ratio 1, particle budgets halved (exposed as `quality.particles` 1 / 0.75 / 0.5).

- [ ] **Step 1: Implement** the files above. `Mages.tsx` mirrors `src/pages/games/Pool.tsx`, passing `api` functions that `fetch` the Task 10 routes.
- [ ] **Step 2: Typecheck and build:** `npm run typecheck && npm run build`. Expected: success.
- [ ] **Step 3: Visual check:** with `npm run dev`, open `/games/mages` (temporary boot straight into a seed-1 map is fine for now). Screenshot with Playwright at 900×520 desktop, 844×390 phone landscape (`isMobile`, `hasTouch`), and 390×844 phone upright. Expected: the whole board is visible, textured, lit, with shadows on High; on Low no shadows; the upright phone shows the board turned sideways and filling the screen.
- [ ] **Step 4: Commit** `"Mage Siege: realistic 3D terrain, camera and quality settings"`.

### Task 12: Mage and enemy figures, animation, visual levels

**Files:**
- Create: `src/games/mages/units.js`

**Interfaces:**
- Consumes: `createScene` (`toWorld`), sim `Mage`, `Enemy`, `pathPoint`.
- Produces: `createUnits(scene, quality) → { sync(sim, alpha), onEvent(ev), dispose() }`. `sync` creates, updates and removes figures to match `sim.mages`/`sim.enemies`, interpolating enemy positions between ticks with `alpha` in 0..1. `onEvent` plays animations: attack recoil, cast pose, hit flash, death dissolve, merge pop, stunned dizzy stars.

Looks per spec: mages are a lathe robe, hood, hands, and a staff with an element-coloured emissive crystal. Per level: scale +4%, aura rings = level, robe trim colour bands at L2–L5, and at L5 a constant point light from the light pool (Task 13) on the staff. A charge ring fills at the feet; when full the mage pulses. Enemies have distinct silhouettes (stocky goblin, four-legged wolf, bulky brute, winged bat with flap, robed shaman, plated metallic knight, towering bark-textured Treant with branch arms, small sapling), walk bob and health bars (boss bar in the HUD instead). Materials are `MeshPhysicalMaterial` with procedural textures, not flat colours.

- [ ] **Step 1: Implement** `units.js` and call it from `engine.js` with a temporary demo sim (seed 1, 3 mages placed via actions, wave started).
- [ ] **Step 2: Build:** `npm run build`. Expected: success.
- [ ] **Step 3: Visual check:** screenshot at 900×520 with mages at L1, L3 and L5 (temporary demo merges) and every enemy kind spawned via `spawnForTest`. Expected: levels are distinguishable at a glance, each enemy is recognisable, nothing looks flat or untextured.
- [ ] **Step 4: Commit** `"Mage Siege: mage and enemy figures with level visuals"`.

### Task 13: Effects and the game loop

**Files:**
- Create: `src/games/mages/fx.js`
- Modify: `src/games/mages/engine.js`

**Interfaces:**
- Consumes: sim events from every earlier task, `createScene`, `createUnits`.
- Produces:
  - `createFx(scene, quality) → { onEvent(ev, sim), update(dt), dispose() }` with internal pools: an additive particle system, a normal-blended particle system with per-particle alpha (port Pool's `solidParticles` from `src/games/pool/engine.js`), projectile meshes with trails, a point-light pool of at most 8, and `shake(strength)`.
  - In `engine.js`, the loop: accumulate real time × speed (1 or 2); run `step(sim, actionsForTick)` at 30 Hz, at most 8 ticks per frame; feed events to units and fx; render with interpolation `alpha`. Pause on `visibilitychange` when hidden (Review Focus 2). Actions from input are queued with `t = sim.tick` and appended to the run's action log.

Effects per spec, each growing with level (more particles, bigger radius, brighter light at L4–L5): fire (fireball projectile with ember trail, flame pillars with rising solid-blended flames, lava glow), ice (shard projectile, frost mist, blizzard snow swirl, freeze crystals on enemies, shatter burst), lightning (instant jagged bolt made of a dense solid-particle chain plus a point-light flash, chain arcs between targets, charged ground crackle), earth (rock projectile, dust and debris, quake ring, rising rock wall), poison (dart with green trail, bubbling stacks on enemies, drifting plague cloud), wind (swirling streak projectile, tornado funnel of particles). Traps: spike thrust, barricade splinters, frost rune glow, mine blast. Spells: meteor falling with a fire trail, impact flash and shake; time freeze blue screen tint plus frozen enemies; mana surge rings on every mage. Boss skills: saplings sprouting, Root Slam shockwave on the slammed mages, Witch shield bubble.

- [ ] **Step 1: Implement** `fx.js` and the loop.
- [ ] **Step 2: Build:** `npm run build`. Expected: success.
- [ ] **Step 3: Visual check:** with the demo sim and the dev hook `window.__mages = { sim, tick(n), cast(tile) }` (behind `import.meta.env.DEV`), cast every active at L1 and L5, trigger every trap and spell, and screenshot each moment (step the sim with `tick` to the right frame, as done for Pool's cue effects). Expected: every effect is clearly visible over grass, dirt and water, with real colours (no washed-out additive-on-bright-ground look) and a visible L1 vs L5 difference.
- [ ] **Step 4: Commit** `"Mage Siege: spell, passive, trap and boss effects"`.

### Task 14: Input, HUD, screens and run submission

**Files:**
- Create: `src/games/mages/input.js`, `src/games/mages/ui.js`
- Modify: `src/games/mages/engine.js`
- Test: `src/games/mages/ui.test.ts` (pure helpers only)

**Interfaces:**
- Consumes: `createScene` (`tileAt`, `loc`), `terrain.setHighlight`, `MAGES`/`TRAPS`/`SPELLS`, `magePrice(sim)` and `sim.gold` (to grey out unaffordable shop items), `sim.spellCd`, `unlocked`, `MagesApi`.
- Produces:
  - `input.js`: `createInput(scene, handlers)` emitting `tap(tile)`, `dragStart(tile)`, `dragMove(tile)`, `dragEnd(fromTile, toTile)` from pointer events in both normal and sideways mode.
  - `ui.js`: the screens (world map with stars and Endless lock, team select, HUD, shop tabs Mages | Traps | Spells, pause with quality and quit, results), the boss health bar, mage info on tap (level, passive and active text, Sell button), and storage helpers `savePendingRun(run)`, `loadPendingRun()`, `clearPendingRun()` under `0xhubms.pending` (try/catch around storage).

Interaction rules: tapping a shop mage enters place mode and highlights boost tiles for that mage (terrain `setHighlight`); tapping a valid tile queues `place`; tapping elsewhere cancels. Dragging a mage queues `merge` when dropped on the same kind and level, `move` when dropped on an empty buildable tile, and otherwise snaps back (Review Focus 1). Tapping a charged mage casts an instant active; for a targeted active it enters target mode (path tiles glow) and the next path tap queues `cast`. Traps: tap the trap, then a path tile. Spells: tap; Meteor needs a target tap. A 1×/2× speed toggle and Pause are top right. Submission follows Task 10's client contract: after each `waveEnd`, post that wave's batch with `api.input(runId, { upTo, actions, h: hashSim(sim) })` in the background; when the run ends, post the final batch (`final: true`). Unsent batches are queued with `savePendingRun({ runId, batches })` and retried in order; the result screen waits for the final response (stars, new unlocks, Endless rank). On failure show "Couldn't save your result" with Retry (Review Focus 3). On mount, a leftover pending run is retried first. A server rejection (`ok: false`) shows "This run couldn't be verified" and returns to the world map.

- [ ] **Step 1: Write the failing tests** in `ui.test.ts`: `pending batches round-trip through storage in order` (with a stubbed `localStorage`), `clearPendingRun removes it`, `storage errors are swallowed` (a stub that throws on `setItem` makes `savePendingRun` not throw and `loadPendingRun` return null).
- [ ] **Step 2: Run** `npx vitest run src/games/mages/ui.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `input.js` and `ui.js`, and wire the full flow in `engine.js` (world map → team → `api.start` → map from seed → play → finish).
- [ ] **Step 4: Run** `npx vitest run src/games/mages/ui.test.ts && npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Play-test** with Playwright as a guest: clear stage 1 (use the dev hook to speed up if needed); results show stars and the Barricade unlock; the world map shows stage 2 open. Drop a fire mage on an ice mage: it snaps back. Kill the network (route abort) before finish: the Retry message appears, and after restoring it Retry succeeds.
- [ ] **Step 6: Commit** `"Mage Siege: controls, HUD, screens and verified run submission"`.

### Task 14b: Verification that fits the Cloudflare free plan (10 ms CPU per request)

**Why:** the user runs 0xHub on the Workers **free plan** and will not upgrade (personal project). Free-plan Workers and Durable Objects get about **10 ms of CPU per invocation** (requests and alarms alike). Task 10's per-wave chunks simulate a whole wave in one request: about 20 ms on average, 66–104 ms in the worst wave (Task 9b report, bundled). Those requests would fail with "exceeded CPU" on the live site. The user accepts that **the final score (and stage stars/unlocks) is confirmed with a short delay**, so verification becomes deferred and sliced: no request may simulate more than a small, bounded amount.

**Files:**
- Modify: `shared/games/mages/chunk.ts` (resumable, budgeted advance), `worker/mageChunk.ts` (queue + slice decisions, still pure), `worker/mages.ts` (MageRun: queue storage, one slice per invocation, alarm chain), `worker/mageChunk.test.ts`, `shared/games/mages/chunk.test.ts`
- Modify: Task 14's client submission code (in `src/games/mages/ui.js` / `engine.js`, wherever Task 14 put it) and `src/pages/games/Mages.tsx` only if the API shape requires
- Create: a bench script under `scripts/` or the scratch folder (not shipped) for the CPU measurement

**Ruling R43 (binding):** free plan, deferred sliced verification as specified here; the security properties of Task 10 stay (server picks seed and config; hash checked at every chunk end; any mismatch/malformed chunk/too many actions/ahead of 2× wall clock kills the run; retries safe per R34; exactly-once recording per R34/R36; quitting rules per R33/R35/R36).

**Server design:**
1. **Upload is cheap.** `input` stores the chunk (`upTo`, `actions`, `h`, `final`) in a queue in the DO's SQLite storage after only cheap checks: owner, shape, `validateActions` against the end of the *queued* chunks (not the verified sim tick), the per-run action cap, and the 2× wall-clock check on `upTo`. No full-chunk simulation in the upload path. Duplicate/behind semantics (R34) apply against the last *queued* chunk (same `upTo` + same `h` → same ack; `upTo` below the last queued → refused without killing). The 150 s chunk-length cap (R31) can stay as an upload check.
2. **Verification runs in slices.** A slice restores the sim (or reuses a copy cached in memory on the DO instance when warm), advances it toward the next queued chunk's `upTo` by at most a deterministic **work budget**, checks the hash when it reaches a chunk end, persists the snapshot plus the verified position, and stops. `advance` must become resumable mid-chunk: stepping to an intermediate tick with the right subset of that chunk's actions. Pure and unit-tested.
3. **Work budget, not time.** `Date.now()` does not advance during CPU work in Workers, so budget by work units counted while stepping, e.g. Σ per tick of (1 + live enemies + mages + zones). Calibrate with a bundled (esbuild/vite, like Task 9b's bench) node benchmark over the worst late-Endless waves of the 100-wave cost run. Target: worst slice, including restore + serialize, **≤ 4 ms warm** on this machine. Report the budget, worst and median slice ms, and slices per average wave.
4. **Cold-start and self-healing.** When the sim isn't cached in memory (a cold or evicted DO, where JIT is cold too), use a quarter budget for that slice. Before running a slice, persist an "attempt" counter. If a slice starts and finds the counter already set (the previous invocation died, e.g. CPU limit exceeded), halve the budget for this run (keep a floor) before trying again. Clear the counter after a slice commits. A slice that hit the CPU limit therefore never wedges the run.
5. **Who drives slices:** every `input` request runs one slice after storing its chunk. A new cheap poll (`POST /api/mages/runs/:id/input` with `{ poll: true }`, or a separate `/verify` route; your choice, but keep `MagesApi` small) runs one slice and returns progress. While a backlog exists, the DO keeps an alarm about 1 s ahead that runs one slice per firing, so verification finishes even if the player closes the page. Multiplex the single alarm slot with the existing abandon timer (store the abandon deadline; the alarm decides which job is due). A run with an unverified backlog must never be discarded as abandoned until the backlog is verified or the run dies.
6. **Responses:** uploads and polls return `{ ok: true, pending: true, verifiedTo, queuedTo }` while verification is behind. Once the final chunk is verified, they return the same final result as before (`finished`, outcome, progress, best, rank), kept for retries. A run that fails verification answers `{ ok: false, error }` to the next upload or poll.
7. **Recording** stays exactly-once (done marker before D1 writes, `recordScoreOnce`). The slice that reaches the end of the final chunk marks the run done. D1 recording may happen in that invocation (it is I/O, not CPU) or in the next one.
8. **Request budget sanity:** the free plan also caps requests (about 100k Worker requests per day, and Durable Object requests/alarms similarly). Report the expected request count for a 10-minute stage run and a 30-minute Endless run. It should be well within a personal project's daily limits.

**Client changes:**
- Post a chunk **about every 2 s of real time** while a wave is running (plus at `waveEnd` and the final chunk, as now). Uploads are cheap now, and frequent posts keep the verification backlog small, because each post also drives one slice. Keep the pending-batch queue and retry from Task 14 (`0xhubms.pending`).
- **Results screen:** while the final response is `pending`, show "Verifying your score…" with a progress bar (`verifiedTo / queuedTo`) and poll about once a second. Then show stars, unlocks and Endless rank as before. If the player leaves early, nothing is lost: the alarm chain finishes and records it. Show "Your score will appear on the leaderboard in a minute" if they leave the results screen while it's still pending.
- The world map must not unlock the next stage locally before the server confirms. After a pending stage win, refresh `progress` once verification is done (or on next mount).

**Tests (TDD):**
- Slicing equivalence: verifying the stage-1 scripted run and the 30-wave Endless run in slices of random budgets (seeded) gives exactly the same per-chunk hashes and `outcomeOf` as one `replay`.
- Resumable advance: stopping mid-chunk and resuming, with a JSON round trip between slices, matches.
- Queue semantics: duplicate, behind and final retry (R34) evaluated against queued chunks; a hash mismatch found in a later slice kills the run, and later uploads and polls get `ok: false`.
- Self-healing: a set attempt counter halves the budget, down to a floor.
- Alarm multiplexing: a backlog keeps the run alive past the abandon deadline; an idle run with an empty backlog is still discarded.
- Existing `mageChunk.test.ts` and `chunk.test.ts` pins: replay hashes must be unchanged (sim code is not modified).

**Verification:**
- `npm run typecheck && npm test && npm run build`.
- Bench numbers in the report.
- Playwright: play stage 1 with the real local server (dev hook allowed for speed) and finish. The results screen shows "Verifying…" briefly, then stars and the unlock. Close the page right after finishing an Endless run with a backlog; after the alarm chain runs, the leaderboard lists the score.
- Commit: `"Mage Siege: deferred sliced verification for the Workers free plan"`.

### Task 15: Hub integration and final verification

**Files:**
- Modify: `src/games/registry.ts` (new entry after `pool`), `src/components/GameLogo.tsx` (a `mages` case next to `pool` at ~line 144), `src/pages/Leaderboard.tsx:11,33-100,102` (`GameKey`, `BOARDS`, `GAME_KEYS`)

**Interfaces:**
- Consumes: Task 10's leaderboard route.
- Produces: registry entry `{ id: "mages", title: "Mage Siege", tagline: "Merge mages, master the terrain, hold the line.", href: "/games/mages", status: "live", modes: ["Campaign", "Endless"], gradient: "from-violet-700/40 via-indigo-800/30 to-amber-600/30" }`; a Mage Siege logo (staff with a glowing crystal) in the existing logo style; leaderboard board `mages` with one mode `endless` and columns Score (strong) and When.

- [ ] **Step 1: Implement** the three edits.
- [ ] **Step 2: Full verification:** `npm run typecheck && npm test && npm run build`. Expected: all pass.
- [ ] **Step 3: Final play-test** (Playwright, guest): the Games page shows Mage Siege; clear all 5 World 1 stages (dev hook allowed for speed), including the Treant fight with saplings and Root Slam visible; Endless unlocks; play Endless to wave 20 with the real sim, then lose; the leaderboard's Mage Siege tab lists the score. Screenshots at 844×390 phone landscape, 390×844 upright, desktop, and the Low quality setting.
- [ ] **Step 4: Commit** `"Mage Siege: add to the hub, logo and leaderboard"`.
