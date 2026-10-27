// Mage Siege balance data: plain tables, no logic. Durations are written in
// seconds and converted to ticks with secs() where the simulation uses them.

export const TICK_HZ = 30;
export const secs = (s: number): number => Math.round(s * TICK_HZ);

/** Map size in tiles; tile index = y * W + x. */
export const W = 16;
export const H = 9;

export type MageId = "fire" | "ice" | "lightning" | "earth" | "poison" | "wind";
export type EnemyId =
  | "goblin" | "wolf" | "brute" | "bat" | "shaman" | "knight"
  | "goblinChief" | "direWolf" | "troll" | "witch" | "treant" | "sapling";
export type TrapId = "spike" | "barricade" | "frost" | "mine";
export type SpellId = "meteor" | "freeze" | "surge";
export type BuildTerrain = "grass" | "hill" | "water" | "lava" | "crystal" | "forest" | "well" | "ruins" | "blocked";
export type PathTerrain = "dirt" | "mud" | "ice" | "bridge";

export interface MageDef {
  name: string;
  dmg: number;
  /** Attacks per second. */
  aps: number;
  /** Tiles. */
  range: number;
  /** Splash radius in tiles; 0 for single target. */
  splash: number;
  /** Damage multiplier against flying enemies. */
  vsFlying: number;
  /** Terrain that boosts this mage. */
  boost: BuildTerrain[];
  /** Per-level main passive number (see comments on each mage). */
  passive: number[];
  /** Per-level main active number (see comments on each mage). */
  active: number[];
  /** True if the active asks for a target point. */
  activeTargeted: boolean;
  /** Per-level stun length in seconds of the active, where it has one. */
  stun?: number[];
}

export const MAGES: Record<MageId, MageDef> = {
  fire: {
    name: "Fire Mage", dmg: 14, aps: 1.0, range: 2.6, splash: 0.6, vsFlying: 1,
    boost: ["lava"],
    passive: [30, 40, 50, 60, 80], // burn per second, % of hit damage
    active: [1, 2, 3, 4, 5], // flame pillars
    activeTargeted: true,
  },
  ice: {
    name: "Ice Mage", dmg: 8, aps: 1.1, range: 2.6, splash: 0, vsFlying: 1,
    boost: ["water"],
    passive: [20, 25, 30, 35, 40], // slow %
    active: [1.5, 1.5, 1.5, 2, 2], // blizzard radius, tiles
    activeTargeted: true,
  },
  lightning: {
    name: "Lightning Mage", dmg: 11, aps: 1.2, range: 2.8, splash: 0, vsFlying: 1.25,
    boost: ["crystal"],
    passive: [2, 3, 4, 5, 6], // extra enemies per chain
    active: [3, 5, 7, 9, 10], // thunder stun targets
    activeTargeted: false,
    stun: [1, 1.4, 1.8, 2.2, 2.5],
  },
  earth: {
    name: "Earth Mage", dmg: 30, aps: 0.5, range: 2.4, splash: 0, vsFlying: 1,
    boost: ["forest"],
    passive: [2, 3, 4, 5, 6], // armor removed per hit
    active: [3, 3, 3, 3, 3], // earthquake path tiles
    activeTargeted: true,
    stun: [1.2, 1.2, 1.2, 1.2, 1.2],
  },
  poison: {
    name: "Poison Mage", dmg: 5, aps: 1.3, range: 2.6, splash: 0, vsFlying: 1,
    boost: ["forest"],
    passive: [3, 4, 5, 6, 8], // max venom stacks
    active: [1.5, 1.5, 1.5, 1.5, 1.5], // plague cloud radius, tiles
    activeTargeted: true,
  },
  wind: {
    name: "Wind Mage", dmg: 6, aps: 2.0, range: 2.8, splash: 0, vsFlying: 1,
    boost: [],
    passive: [10, 12, 14, 16, 20], // gust chance per hit, %
    active: [1, 1, 1, 1, 2], // tornado count
    activeTargeted: false,
  },
};

/** Per-level scaling: damage x1.8, attack speed +8%, range +5%. */
export const LEVEL = { dmg: 1.8, aps: 0.08, range: 0.05 };
export const MAX_LEVEL = 5;
export const ACTIVE_CHARGE_SECS = 14;

export interface EnemyDef {
  hp: number;
  /** Tiles per second. */
  speed: number;
  armor: number;
  gold: number;
  flying: boolean;
  boss: "mini" | "final" | null;
  /** Lives lost when it reaches the exit. */
  leak: number;
}

const enemy = (hp: number, speed: number, armor: number, gold: number, flying = false, boss: EnemyDef["boss"] = null, leak = 1): EnemyDef =>
  ({ hp, speed, armor, gold, flying, boss, leak });

// Stage 1 values. Mini-bosses are 12x their base enemy's HP and gold, Treant is 40x a brute's HP.
export const ENEMIES: Record<EnemyId, EnemyDef> = {
  goblin: enemy(40, 1.0, 0, 4),
  wolf: enemy(30, 1.8, 0, 5),
  brute: enemy(160, 0.7, 2, 10),
  bat: enemy(35, 1.3, 0, 6, true),
  shaman: enemy(60, 0.9, 0, 8),
  knight: enemy(120, 0.8, 8, 12),
  goblinChief: enemy(480, 1.0, 0, 48, false, "mini", 5),
  direWolf: enemy(360, 1.8, 0, 60, false, "mini", 5),
  troll: enemy(1920, 0.7, 2, 120, false, "mini", 5),
  witch: enemy(720, 0.9, 0, 96, false, "mini", 5),
  treant: enemy(6400, 0.5, 6, 100, false, "final", 999),
  sapling: enemy(200, 0, 0, 0, false, null, 0),
};

/** ENEMIES[e.kind], cached on the enemy (keyed lookups by kind are slow in the hot loops). */
export const enemyDef = (e: { kind: EnemyId; def?: EnemyDef }): EnemyDef => e.def ?? (e.def = ENEMIES[e.kind]);

/** Secondary passive numbers (seconds, tiles, fractions); per-level arrays are indexed by level - 1. */
export const PASSIVES = {
  /** Fire: burn lasts 3 s; from L3 it spreads on death (1 tile), at L5 the death also explodes (1 tile, 100% hit damage). */
  burnSecs: 3,
  burnSpreadLevel: 3,
  burnSpreadRadius: 1,
  explodeLevel: 5,
  explodeRadius: 1,
  explodeDmg: 1,
  /** Ice: slow lasts 2 s; from L3 every 5th hit freezes for 1 s. */
  slowSecs: 2,
  freezeLevel: 3,
  freezeEvery: 5,
  freezeSecs: 1,
  /** Lightning: every 3rd attack chains (every attack at L5), each jump 70% of the previous, within 1.5 tiles. */
  chainEvery: 3,
  chainAlwaysLevel: 5,
  chainRadius: 1.5,
  chainFalloff: 0.7,
  /** Earth: L5 quake, 40% damage within 0.8 tiles. */
  quakeLevel: 5,
  quakeRadius: 0.8,
  quakeDmg: 0.4,
  /** Poison: each stack deals 4 x level dps for 4 s; at L5 stacks jump to the nearest enemy within 1.5 tiles on death. */
  venomDpsPerLevel: 4,
  venomSecs: 4,
  venomJumpLevel: 5,
  venomJumpRadius: 1.5,
  /** Wind: knockback in tiles per level. */
  knockback: [0.5, 0.5, 0.5, 0.5, 1],
};

/** Active skill numbers not in the per-level tables (seconds, tiles, tiles/s, multiples of hit damage). */
export const ACTIVES = {
  /** Hit radius around a pillar, quake tile, charged/lava zone, and tornado touch radius. */
  zoneRadius: 0.6,
  /** Level whose active leaves lava, charged ground, a rock wall, a drifting cloud or a second tornado. */
  bonusLevel: 5,
  /** Fire: each pillar deals 300%; L5 lava burns (the caster's L5 burn) for 5 s. */
  pillarDmg: 3,
  lavaSecs: 5,
  /** Ice: blizzard lasts 4 s, slows 50%, 60% hit damage per second; L5 freezes everything inside for 2 s on start. */
  blizzardSecs: 4,
  blizzardSlow: 0.5,
  blizzardDps: 0.6,
  blizzardFreezeSecs: 2,
  /** Lightning: strikes within 2x range for 250%; L5 struck tiles zap 50% hit damage per second for 4 s. */
  thunderRange: 2,
  thunderDmg: 2.5,
  chargedSecs: 4,
  chargedDps: 0.5,
  /** Earth: 200% damage; L5 rock wall blocks ground enemies for 3 s. */
  quakeDmg: 2,
  wallSecs: 3,
  /** Poison: cloud lasts 5 s and adds 1 stack every second. */
  plagueSecs: 5,
  plagueStackSecs: 1,
  /** Wind: travels back from the exit at 4 tiles/s for 3 s, carries each ground enemy at most 2 tiles, 100% hit damage per second; the L5 second one starts 1 s later. */
  tornadoSecs: 3,
  tornadoSpeed: 4,
  tornadoCarry: 2,
  tornadoDps: 1,
  tornadoDelaySecs: 1,
};

/** Enemy traits and boss skills: periods in seconds, radii in tiles, fractions of max HP. */
export const ABILITIES = {
  /** Shaman: heals every enemy in range (itself included) for 8% of its max HP. */
  shamanHealSecs: 3,
  shamanHealRadius: 1.5,
  shamanHealPct: 0.08,
  /** Goblin Chief: calls goblins at its own position. */
  chiefSummonSecs: 6,
  chiefSummonCount: 4,
  /** Dire Wolf: sprints at 2x speed for 2 s, every 8 s. */
  wolfSprintEverySecs: 8,
  wolfSprintSecs: 2,
  wolfSprintSpeed: 2,
  /** Troll: regains 1% max HP per second unless burning or poisoned. */
  trollRegenSecs: 1,
  trollRegenPct: 0.01,
  /** Witch: shields every enemy in range (herself included) for 3 s, every 7 s. */
  witchShieldEverySecs: 7,
  witchShieldSecs: 3,
  witchShieldRadius: 2,
  /** Ancient Treant: saplings ahead of it, healing, Root Slam, enrage. */
  treantPlantSecs: 10,
  treantSaplings: 3,
  /** Saplings never sit closer than this to the exit, so they cannot leak. */
  saplingEndMargin: 0.5,
  treantHealSecs: 1,
  treantHealPctPerSapling: 0.01,
  treantSlamSecs: 15,
  treantSlamTargets: 3,
  treantSlamStunSecs: 3,
  /** Below this fraction of max HP the Treant moves faster. */
  treantEnrageBelow: 0.5,
  treantEnrageSpeed: 1.3,
};

/** Fraction of damage a shielded enemy takes. */
export const SHIELD_DAMAGE = 0.5;

/** Bosses (mini and final) take stuns and freezes this much as long. */
export const BOSS_STUN = 0.5;

export const TERRAIN_BOOST = {
  dmg: 0.3,
  hillRange: 0.25,
  crystalCharge: 0.2,
  wellCharge: 0.35,
  ruinsGold: 0.5,
  mudSpeed: 0.6,
  iceSpeed: 1.3,
};

export interface TrapDef {
  price: number;
  durability: number;
  /** Damage (spike, mine), damage per second to durability is fixed by the sim (barricade), slow fraction (frost). */
  value: number;
  /** Duration in seconds, where the effect has one. */
  secs?: number;
}

export const TRAPS: Record<TrapId, TrapDef> = {
  spike: { price: 40, durability: 30, value: 20 },
  barricade: { price: 60, durability: 40, value: 0 },
  frost: { price: 50, durability: 40, value: 0.4, secs: 2 },
  mine: { price: 70, durability: 1, value: 150 },
};
export const MAX_TRAPS = 6;

export interface SpellDef {
  cost: number;
  /** Seconds. */
  cooldown: number;
  /** Meteor damage, or freeze seconds (bosses get half); 0 for Mana Surge. */
  value: number;
}

export const SPELLS: Record<SpellId, SpellDef> = {
  meteor: { cost: 80, cooldown: 30, value: 400 },
  freeze: { cost: 120, cooldown: 60, value: 3 },
  surge: { cost: 150, cooldown: 90, value: 0 },
};

export const ECON = {
  startGold: 120,
  magePrice: 50,
  priceStep: 10,
  waveBonus: (w: number): number => 20 + 5 * w,
  sellRate: 0.5,
};

export const LIVES = 20;
/** Minimum lives left for 3 stars, 2 stars, 1 star. */
export const STARS = [18, 10, 0];
export const BUILD_BREAK_SECS = 12;
/** HP multiplier per stage, per wave, and per wave in Endless. */
export const STAGE_HP = 1.35;
export const WAVE_HP = 1.1;
export const ENDLESS_WAVE_HP = 1.12;
/** Kill gold and wave bonus multiplier per stage (stage mode only; Endless pays the stage 1 rates). */
export const GOLD_STAGE = 1.35;
/** Per-wave HP multiplier for stage-mode bosses and the Treant's saplings (they scale by stage only: 1). */
export const BOSS_WAVE_HP = 1;
/** Endless runs end (won) after this many waves. */
export const ENDLESS_MAX_WAVES = 300;
/** Spike and mine damage multiplier per stage. */
export const TRAP_STAGE_SCALE = 1.25;
/** Meteor damage multiplier per stage. */
export const METEOR_STAGE_SCALE = 1.35;

export interface Unlock {
  mages?: MageId[];
  traps?: TrapId[];
  spells?: SpellId[];
  endless?: true;
}

export const UNLOCKS: { start: Unlock; stages: Record<1 | 2 | 3 | 4 | 5, Unlock> } = {
  start: { mages: ["fire", "ice", "lightning"], traps: ["spike"], spells: ["meteor"] },
  stages: {
    1: { traps: ["barricade"] },
    2: { mages: ["earth"] },
    3: { traps: ["frost"], spells: ["freeze"] },
    4: { mages: ["poison"], traps: ["mine"] },
    5: { mages: ["wind"], spells: ["surge"], endless: true },
  },
};
