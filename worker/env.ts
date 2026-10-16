import type { EndlessRun } from "./endless";
import type { Matchmaker } from "./matchmaker";
import type { BattleRoom } from "./room";

export interface Env {
  DB: D1Database;
  MATCHMAKER: DurableObjectNamespace<Matchmaker>;
  BATTLE_ROOM: DurableObjectNamespace<BattleRoom>;
  ENDLESS_RUN: DurableObjectNamespace<EndlessRun>;
}
