-- Generic tables for Snake Arena, 2048 (solo + duel), Minesweeper Rush and Connect Four.

-- Per-game rating and record (1v1 games use Elo; Snake uses only the counters).
CREATE TABLE game_ratings (
  user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game     TEXT NOT NULL,
  rating   INTEGER NOT NULL DEFAULT 1000,
  played   INTEGER NOT NULL DEFAULT 0,
  wins     INTEGER NOT NULL DEFAULT 0,
  losses   INTEGER NOT NULL DEFAULT 0,
  draws    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, game)
);
CREATE INDEX game_ratings_rank ON game_ratings(game, rating DESC);
CREATE INDEX game_ratings_wins ON game_ratings(game, wins DESC);

-- Finished multiplayer matches.
CREATE TABLE game_matches (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  game         TEXT NOT NULL,
  room         TEXT NOT NULL,
  reason       TEXT NOT NULL,
  duration_ms  INTEGER NOT NULL,
  created_at   INTEGER NOT NULL
);

CREATE TABLE game_match_players (
  match_id      INTEGER NOT NULL REFERENCES game_matches(id) ON DELETE CASCADE,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  place         INTEGER NOT NULL,  -- 1 = winner; equal places = draw
  score         INTEGER NOT NULL,
  rating_delta  INTEGER NOT NULL DEFAULT 0,
  data          TEXT,              -- per-game details (JSON)
  PRIMARY KEY (match_id, user_id)
);
CREATE INDEX game_match_players_user ON game_match_players(user_id, match_id DESC);

-- Verified solo results: 2048 solo score, Minesweeper times (score = ms, lower is better),
-- Snake round scores.
CREATE TABLE game_scores (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game         TEXT NOT NULL,
  mode         TEXT NOT NULL,
  score        INTEGER NOT NULL,
  duration_ms  INTEGER NOT NULL,
  data         TEXT,
  created_at   INTEGER NOT NULL
);
CREATE INDEX game_scores_board ON game_scores(game, mode, score);
CREATE INDEX game_scores_user ON game_scores(user_id, game, mode, score);
