# Mage Siege: design (Phase 1)

A merge tower-defense game for 0xHub. You buy mages, place them on a randomly generated 3D battlefield, and merge two copies of the same mage at the same level into a stronger one. Every merge upgrades the mage's power, its passive and its tap-to-cast active skill. Traps on the path and one-off spells add more ways to defend. A campaign of worlds unlocks new mages, traps and spells; Endless mode feeds a leaderboard.

This spec covers **Phase 1**: the complete engine plus World 1 and Endless mode. Worlds 2–4 (Scorched Desert, Frozen Peaks, Shadow Realm) each get their own spec and plan later.

## Goals

- A fun, strategic single-player game: team choice, tile choice (terrain) and timing (active skills, spells) all matter.
- Showy effects: every passive, active, trap and spell has its own particles, light and impact, and effects visibly grow with merge level.
- A realistic look like 8-Ball Pool: real 3D, PBR materials, shadows and lighting. Not flat or low-poly.
- Playable and smooth on phones in landscape, and on desktop.
- Progress saved to the 0xHub account; leaderboard results that can't be faked.

## Non-goals (Phase 1)

- Worlds 2–4, their bosses, mages, traps and enemies.
- Multiplayer or co-op.
- Paid currency, gacha or anything bought with real money.
- Hand-made or downloaded 3D models. All geometry and textures are generated in code.

## Game flow

1. **World map:** World 1 shows its 5 stages with stars earned, plus Endless (locked until stage 5 is cleared).
2. **Team select:** choose 5 of your unlocked mages (all of them while fewer than 5 are unlocked). Traps and spells: every unlocked one is available.
3. **Stage:** a fresh random map is generated. You get a build phase before wave 1, then waves run back to back with a short build break between them.
4. **Result:** stars, unlocks earned, and buttons for Retry, Next stage, and World map.

### Stage rules

- 10 waves per stage. Wave 10 of stages 1–4 is a mini-boss wave; wave 10 of stage 5 is the Ancient Treant boss.
- **Lives:** 20 per stage. A normal enemy reaching the exit costs 1, a mini-boss costs 5, and the Treant costs all remaining lives.
- **Stars:** 3 for clearing with 18+ lives left, 2 for 10+, 1 for any clear.
- **Build break:** 12 seconds between waves, skippable with "Next wave". Before wave 1 the break has no timer and waits for "Start".
- **Speed:** a 1×/2× toggle. Speed only changes how many simulation ticks run per real second, so replays are unaffected.
- **Pause** is always available and stops the simulation.

## Map generation

- Grid of **16 × 9 tiles**, generated from a seed.
- **Path:** enters on the left edge and exits on the right edge. It's a constrained random walk: it never touches itself (no two non-consecutive path tiles share an edge) and is 34–48 tiles long. Generation retries with the next seed state until the constraints hold.
- **Buildable tiles** are every non-path tile, except blocked ones. At least 40 must be buildable and at least 24 must border the path.
- **Build-tile terrain** (World 1 mix):

| Terrain | Effect | Guaranteed per map |
|---|---|---|
| Grass | none | fills the rest |
| Hill | +25% range | 2 |
| Water | +30% damage for Ice | 2 (lake shape) |
| Lava vent | +30% damage for Fire | 1 |
| Storm crystal | +30% damage for Lightning; any mage's active charges 20% faster | 1 |
| Forest | +30% damage for Earth and Poison | 3 |
| Mana well | any mage's active charges 35% faster | 1 |
| Ruins | kills by this mage give +50% gold | 1 |
| Rocks / deep water | can't build | 6–12 |

- **Path terrain:**

| Terrain | Effect | Per map |
|---|---|---|
| Dirt | none | rest |
| Mud | ground enemies move at 60% speed | 1 stretch of 2–3 tiles |
| Ice patch | ground enemies move at 130% speed | 0–1 stretch of 2 tiles |
| Bridge | crosses the water lake; ground enemies bunch up (spacing halved) | 1 if the path crosses water, otherwise 0 |

- The Wind mage has no boosting terrain in World 1; its terrain arrives in a later world.
- Flying enemies ignore path terrain and traps.

## Economy

- **Starting gold:** 120.
- **Kill gold:** set per enemy type (below). Ruins add +50% for that mage's kills. In stage mode kill gold is multiplied ×1.35 per stage (the same rate as enemy health, rounded to whole gold); Endless pays the stage 1 amounts.
- **Wave bonus:** 20 + 5 × wave number, paid when a wave ends, with the same ×1.35 per stage in stage mode.
- **Mage price:** 50 for the first purchase in a stage, +10 for each purchase after that (any mage).
- **Selling:** refunds 50% of the gold spent on that mage, including both halves of any merge.
- **Traps:** fixed price per type; at most 6 traps on the path at once.
- **Spells:** a gold cost plus a cooldown.

## Mages

### Rules

- Bought from the shop, then placed by tapping a buildable empty tile. While placing, tiles that boost this mage glow.
- **Merge:** drag a mage onto the same mage at the same level. The result is one mage of the next level, on the target tile. Max level 5.
- **Move:** drag a mage onto an empty buildable tile. Free.
- **Level scaling:** damage ×1.8 per level, attack speed +8% per level, range +5% per level. Passive and active parameters follow the per-mage tables below.
- **Looks per level:** the mage figure grows slightly; the aura ring brightens and gains a ring per level; the robe trim gets a new color band at levels 2, 3, 4 and 5; at level 5 the staff crystal emits a constant light.
- **Active skills:** every mage charges a meter over time (base 14 seconds to full; mana well and storm crystal speed it up). When full, the mage glows and pulses. Tap it to cast. Some actives ask for a target point (tap the path); others act on their own when cast.

### Base stats (level 1)

| Mage | Damage | Attacks/s | Range (tiles) | Notes |
|---|---|---|---|---|
| Fire | 14 | 1.0 | 2.6 | small splash (0.6 tile) |
| Ice | 8 | 1.1 | 2.6 | single target |
| Lightning | 11 | 1.2 | 2.8 | single target, can hit flyers well (+25% vs flying) |
| Earth | 30 | 0.5 | 2.4 | single target, heavy |
| Poison | 5 | 1.3 | 2.6 | damage mostly from stacks |
| Wind | 6 | 2.0 | 2.8 | fast hits |

### Passives and actives by level

**Fire.** Passive *Burn*: hits ignite the target for damage over 3 s. Burn per second = 30% / 40% / 50% / 60% / 80% of hit damage at L1–L5. L3+: when a burning enemy dies, burn spreads to enemies within 1 tile. L5: burning enemies explode on death for 100% hit damage in 1 tile. Active *Flame Pillars* (targeted): pillars of fire erupt along the path near the tap point and deal 300% hit damage each. Pillars: 1 / 2 / 3 / 4 / 5. L5 also leaves lava on those tiles for 5 s that burns anything crossing.

**Ice.** Passive *Chill*: hits slow by 20% / 25% / 30% / 35% / 40% for 2 s. L3+: every 5th hit freezes the target for 1 s. L5: frozen enemies take +50% damage from all sources. Active *Blizzard* (targeted): a 1.5-tile-radius storm (2 tiles at L4+) for 4 s that slows 50% and deals 60% hit damage per second. L5: everything inside is frozen for 2 s when it starts.

**Lightning.** Passive *Chain Lightning*: every 3rd attack chains to 2 / 3 / 4 / 5 / 6 extra enemies within 1.5 tiles, each jump dealing 70% of the previous. L5: every attack chains. Active *Thunder Stun* (instant): bolts strike the 3 / 5 / 7 / 9 / 10 frontmost enemies in range ×2, dealing 250% hit damage and stunning for 1 / 1.4 / 1.8 / 2.2 / 2.5 s. L5: struck tiles stay charged for 4 s and zap enemies crossing them.

**Earth.** Passive *Armor Break*: hits remove 2 / 3 / 4 / 5 / 6 armor (permanent, floor 0). L5: each hit also quakes for 40% damage in 0.8 tiles. Active *Earthquake* (targeted): shakes 3 path tiles around the tap point for 200% hit damage and a 1.2 s stun. L5: also raises a rock wall on the center tile that blocks ground enemies for 3 s.

**Poison.** Passive *Venom*: each hit adds a stack (max 3 / 4 / 5 / 6 / 8); each stack deals 4 × level damage per second for 4 s, refreshed on hit. L5: when a poisoned enemy dies, its stacks jump to the nearest enemy within 1.5 tiles. Active *Plague Cloud* (targeted): a 1.5-tile cloud for 5 s that adds 1 stack per second to everything inside and blocks all enemy healing. L5: the cloud drifts along the path with the enemies.

**Wind.** Passive *Gust*: 10% / 12% / 14% / 16% / 20% chance per hit to push the target back 0.5 tiles along the path (1 tile at L5). Bosses are immune to knockback. Active *Tornado* (instant): a tornado travels backward along the path from the exit for 3 s, carrying ground enemies it touches back up to 2 tiles and dealing 100% hit damage per second. L5: two tornadoes, 1 s apart.

## Enemies (World 1)

Health, speed and gold below are for stage 1. Health scales ×1.10 per wave and ×1.35 per stage; gold scales ×1.35 per stage. Bosses (mini-bosses and the Treant, and its saplings) scale by stage only, not per wave, because they appear on wave 10 only. Armor reduces each hit by its value (minimum 1 damage).

| Enemy | HP | Speed (tiles/s) | Armor | Gold | Trait |
|---|---|---|---|---|---|
| Goblin | 40 | 1.0 | 0 | 4 | basic |
| Wolf | 30 | 1.8 | 0 | 5 | fast |
| Brute | 160 | 0.7 | 2 | 10 | detours to attack traps within 1 tile; deals 3× durability damage to traps |
| Bat | 35 | 1.3 | 0 | 6 | flying: ignores traps, path terrain and barricades |
| Shaman | 60 | 0.9 | 0 | 8 | every 3 s heals enemies within 1.5 tiles for 8% of their max HP |
| Armored Knight | 120 | 0.8 | 8 | 12 | high armor |

**Mini-bosses** (wave 10 of stages 1–4) have ×12 health, are immune to knockback and stun lasts half as long on them:

- *Goblin Chief* (stage 1): calls 4 goblins every 6 s.
- *Dire Wolf* (stage 2): sprints at 2× speed for 2 s every 8 s.
- *Troll* (stage 3): regenerates 1% max HP per second unless poisoned or burning.
- *Witch* (stage 4): every 7 s, shields all enemies within 2 tiles for 3 s (they take 50% damage).

**Ancient Treant** (stage 5, wave 10): ×40 health, armor 6, speed 0.5. Every 10 s it plants 3 saplings on path tiles ahead of it. Saplings are stationary enemies with 200 HP (scaled by stage like the Treant) that don't cost lives; while any sapling is alive, the Treant heals 1% of its max HP per second per sapling. Every 15 s, *Root Slam*: stuns the 3 mages nearest the path near it for 3 s (they can't attack or cast). Below 50% HP it moves 30% faster.

### Waves

Each stage defines its 10 waves as data: a list of groups (enemy type, count, spacing in seconds, delay). Stage 1 introduces goblins and wolves; stage 2 adds bats; stage 3 adds brutes; stage 4 adds shamans and knights; stage 5 mixes everything. Exact wave tables live in the data file and are tuned during play-testing.

## Traps

Placed by buying in the Traps tab, then tapping a path tile with no trap. Flying enemies ignore traps. Max 6 at once.

| Trap | Price | Effect | Durability |
|---|---|---|---|
| Spike Trap | 40 | 20 damage to each ground enemy entering the tile (scales ×1.25 per stage) | 30 enemy hits |
| Barricade | 60 | Blocks the tile; ground enemies stop and attack it (1 durability per enemy per second) | 40 |
| Frost Rune | 50 | Enemies on the tile are slowed 40% for 2 s | 40 enemies |
| Blast Mine | 70 | Explodes when a ground enemy enters: 150 damage in 1 tile (scales ×1.25 per stage) | 1 (single use) |

Brutes deal 3× durability damage. A durability bar shows above each trap, and broken traps crumble with an effect.

The Tar Pit and Thorn Wall traps from the original idea move to later worlds.

## Spells

Cast from the Spells tab. Each has a gold cost and a cooldown in seconds.

| Spell | Cost | Cooldown | Effect |
|---|---|---|---|
| Meteor | 80 | 30 | Tap a point: impact for 400 damage in 1.2 tiles (scales ×1.35 per stage) |
| Time Freeze | 120 | 60 | All enemies frozen for 3 s (bosses 1.5 s) |
| Mana Surge | 150 | 90 | Every mage's active skill is fully charged |

Gold Rush and Restore move to later worlds.

## Unlocks

| Clear | Unlocks |
|---|---|
| Start | Fire, Ice, Lightning mages; Spike Trap; Meteor |
| Stage 1 | Barricade |
| Stage 2 | Earth Mage |
| Stage 3 | Frost Rune, Time Freeze |
| Stage 4 | Poison Mage, Blast Mine |
| Stage 5 | Wind Mage, Mana Surge, Endless mode |

Stages unlock in order: stage N+1 opens when stage N is cleared at least once.

## Endless mode

- Random World 1 map, your team of 5, every unlocked trap and spell.
- Waves are generated from a seed: the enemy mix widens as waves go on, health scales ×1.12 per wave, and every 10th wave is a boss wave cycling Goblin Chief → Dire Wolf → Troll → Witch → Ancient Treant.
- 20 lives; the run ends at 0.
- **Score** = waves cleared × 100 + lives left. Leaderboard mode `endless`, higher is better.

## Look and feel (rendering)

Real 3D with three.js 0.128 (already in the project), following 8-Ball Pool's approach: rendered inside a shadow root, lazy-loaded at its route.

- **Camera:** tilted overhead view (about 55°) framing the whole 16 × 9 map in the space between the HUD. Small zoom in and out, no free rotation.
- **Terrain:** a heightfield mesh. Hills are raised. Water sits in a basin with a reflective, rippling shader. Lava vents glow and pulse. The dirt path is slightly sunken. Materials are PBR with procedural textures (grass, dirt, stone, sand, moss), generated on canvases like Pool's felt and wood.
- **Props:** trees, rocks, ruins pillars, crystals and mana wells, built from smooth lathe and extrude geometry with detailed procedural textures. Placement varies per seed.
- **Lighting:** a sun with soft shadows, a sky-colored hemisphere light, distance fog, ACES tone mapping and an environment map for reflections. Spells and level-5 crystals cast real point lights (pooled, at most 8 active).
- **Mages:** figures built in code: a robe (lathe), hood, hands and a staff with a glowing element crystal, colored per element, with emissive trim per level. Idle sway, attack recoil and a casting animation.
- **Enemies:** figures built the same way, each with a distinct silhouette (stocky goblin, four-legged wolf, bulky brute, winged bat, robed shaman, plated knight, towering Treant). Walk bob, hit flash, and a death effect.
- **Effects:** additive particles for glows and sparks, plus a normal-blended particle layer for smoke, fire and snow (the lesson from Pool: additive particles vanish on bright ground). Projectile trails, impact flashes, screen shake on big hits, and per-element looks: fire (embers, flame tongues), ice (shards, frost mist), lightning (jagged bolts with point-light flashes), earth (rock debris, dust), poison (green bubbles and mist), wind (swirling streaks).
- **Quality setting:** High / Medium / Low, auto-picked on first run from device pixel ratio and screen size, changeable in Settings. Low turns off shadows and the water reflection, halves particle budgets and caps pixel ratio at 1.
- **Layout:** landscape always. A phone held upright gets the whole game turned sideways, as in Pool. HUD: gold, lives and wave at the top; boss health bar under it when a boss is out; shop tabs (Mages | Traps | Spells) along the bottom; pause and speed buttons top right.

## Architecture

### Units

| Unit | Location | Responsibility |
|---|---|---|
| RNG | `shared/games/mages/rng.ts` | Seeded PRNG (mulberry32), the only randomness source in the simulation |
| Data | `shared/games/mages/data.ts` | Mages, levels, enemies, traps, spells, terrain, stages, waves, unlocks: plain data, no logic |
| Map | `shared/games/mages/map.ts` | `generateMap(seed, world)`: path, terrain and props layout, with constraint checks |
| Simulation | `shared/games/mages/sim.ts` | `createSim(config)` and `step(sim, actions)`: fixed 30 Hz ticks; enemies, targeting, damage, passives, actives, traps, spells, economy, lives, waves. Emits events (hit, kill, cast, merge, trap broke, …) for the renderer. No DOM, no three.js, no `Math.random`, no wall clock |
| Replay | `shared/games/mages/replay.ts` | `replay(config, actions)`: runs a whole game headless and returns the outcome (cleared?, waves, lives, stars, score) |
| Engine | `src/games/mages/engine.js` | `mountMages(host, opts)`: shadow root, game loop, wires sim ↔ renderer ↔ input ↔ UI |
| Renderer | `src/games/mages/render/*.js` | Terrain, props, mages, enemies, effects, lights; consumes sim state and events |
| Input | `src/games/mages/input.js` | Tap/drag on the 3D board (raycast to tiles), sideways-mode coordinate mapping, turns gestures into sim actions |
| UI | `src/games/mages/ui.js` | World map, team select, HUD, shop, pause, results |
| Page | `src/pages/games/Mages.tsx` | Route `/games/mages`, lazy-loads the engine, passes API callbacks |
| API | `worker/mages.ts` | Start run, finish run (replay-verify), get progress |
| Storage | `migrations/0007_mages.sql` | Progress and run tables |

The simulation never reads the renderer, and the renderer never changes the simulation. Gameplay changes go through actions only.

### Actions

Every player input that affects the game becomes an action stamped with the tick it applies on:

`buy(mage)`, `place(tile)`, `merge(fromTile, toTile)`, `move(fromTile, toTile)`, `sell(tile)`, `cast(tile, targetTile?)`, `trap(type, pathTile)`, `spell(type, targetTile?)`, `startWave()`.

Pause and speed are not actions; they only change how many ticks the client runs per frame.

### Determinism

- The simulation uses integer ticks and the seeded RNG only. Positions are kept as floats but every operation is deterministic across JS engines (no `Math.random`, no wall-clock time, no iteration over unordered collections, and math limited to `+ - * /`, `Math.sqrt`, `Math.floor`, `Math.min`/`max`/`abs`. No `Math.sin`/`cos`/`atan2`/`pow` in the simulation, since their last bits can differ between engines. Angles aren't needed: movement follows the tile path).
- A test runs the same game twice and compares a state hash after every wave.

### Saving progress and fair results

**Tables (D1, `0007_mages.sql`):**

- `mage_progress (user_id PK, data TEXT, updated_at)`: JSON `{ cleared: {stage: stars}, unlocked: {mages, traps, spells}, endlessBest }`.
- `mage_runs (id PK, user_id, mode, stage, seed, created_at, finished_at NULL)`.

**Flow:**

1. `POST /api/mages/start {mode, stage, team}`: checks the stage is unlocked and every team mage is unlocked, creates a run with a server-chosen seed, returns `{runId, seed}`. The client generates the map from that seed.
2. During play the client records actions locally.
3. `POST /api/mages/finish {runId, actions}`: loads the run (must belong to the caller and be unfinished), replays it on the server with the stored seed and team, and records the replay's outcome, never a client-claimed one. Stars and unlocks update `mage_progress`; Endless scores go to `game_scores` through `recordScore(db, user, "mages", "endless", score, durationMs)`.
4. `GET /api/mages/progress`: returns the caller's progress (empty progress for new players).

**Limits:** at most 20,000 actions per run, an Endless cap of 300 waves, and unfinished runs older than 24 hours are deleted by the existing daily cron.

**Replay cost:** measured early in implementation. If a long Endless replay exceeds the Worker CPU budget, the fallback is to verify Endless runs in chunks across several requests, or to verify only the first 100 waves fully plus sanity checks on the rest. The plan picks one based on the measurement.

**Leaving mid-run:** quitting or closing the tab just abandons the run. Nothing is recorded, and the run row expires.

### Hub integration

- `src/games/registry.ts`: new entry `mages`, title "Mage Siege", modes `["Campaign", "Endless"]`.
- `GameLogo` gets a Mage Siege logo.
- Leaderboard page: an Endless tab for Mage Siege, using the existing `game_scores` leaderboard query.
- `App.tsx`: lazy route `/games/mages`.

## Testing

**Automated (vitest, in `shared/games/mages/*.test.ts` and worker tests):**

- Map: 500 seeds all produce a connected left-to-right path within length bounds, never self-touching, with the guaranteed terrain counts and enough buildable tiles.
- Merge: same mage and level merges; different mage or level is rejected; level 5 can't merge; sell refunds are correct.
- Each mage at each level: passive and active numbers match the tables (chain counts, stun lengths, burn spread, freeze, knockback, poison stacks and jumps, pillars, blizzard radius, wall block).
- Traps: durability drops per the rules, Brutes deal 3×, traps break at 0, flyers ignore traps, the 6-trap cap holds.
- Spells: cost, cooldown and effects; bosses get half-length freezes.
- Economy: purchase price steps, wave bonus, kill gold, ruins bonus.
- Waves and lives: leak costs, star thresholds, Treant leak ends the run.
- Determinism: identical action logs give identical state hashes; a different seed gives a different map.
- API: rejects a locked stage or locked mage, someone else's run, an already finished run, and a tampered action log (illegal action, such as merging mismatched mages); records the replayed outcome.

**Manual play-tests with screenshots:** phone landscape, phone held upright (sideways mode), desktop, and the Low quality setting. All World 1 stages are cleared once, and an Endless run reaches wave 20.

## Phase 2+ outline (not in this spec)

Each later world adds: its terrain mix, 4 stages plus a boss stage, its enemies, two or three mages (from Water, Light, Shadow, Arcane, Time, Summoner, Dragon), the remaining traps (Tar Pit, Thorn Wall) and spells (Gold Rush, Restore).
