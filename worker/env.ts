import type { Matchmaker } from "./matchmaker";
import type { BattleRoom } from "./room";
import type { Leaderboard } from "./leaderboard";

export interface Env {
  MATCHMAKER: DurableObjectNamespace<Matchmaker>;
  BATTLE_ROOM: DurableObjectNamespace<BattleRoom>;
  LEADERBOARD: DurableObjectNamespace<Leaderboard>;
}
