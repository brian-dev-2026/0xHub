import type { EndlessRun } from "./endless";
import type { ChessRoom } from "./games/chessRoom";
import type { GeneralsRoom } from "./games/generalsRoom";
import type { Connect4Room } from "./games/connect4Room";
import type { Duel2048Room } from "./games/duel2048Room";
import type { SnakeRoom } from "./games/snakeRoom";
import type { MinesRun, Run2048 } from "./games/soloRuns";
import type { Matchmaker } from "./matchmaker";
import type { BattleRoom } from "./room";

export interface Env {
  DB: D1Database;
  MATCHMAKER: DurableObjectNamespace<Matchmaker>;
  BATTLE_ROOM: DurableObjectNamespace<BattleRoom>;
  ENDLESS_RUN: DurableObjectNamespace<EndlessRun>;
  SNAKE_ROOM: DurableObjectNamespace<SnakeRoom>;
  DUEL2048_ROOM: DurableObjectNamespace<Duel2048Room>;
  CONNECT4_ROOM: DurableObjectNamespace<Connect4Room>;
  MINES_RUN: DurableObjectNamespace<MinesRun>;
  RUN2048: DurableObjectNamespace<Run2048>;
  CHESS_ROOM: DurableObjectNamespace<ChessRoom>;
  GENERALS_ROOM: DurableObjectNamespace<GeneralsRoom>;
}
