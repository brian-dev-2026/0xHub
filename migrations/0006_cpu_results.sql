-- Results of games against the computer (Chess, Game of the Generals, 8-Ball Pool).
-- These games run in the browser, so results are self-reported: the API
-- rate-limits them, rejects implausibly quick wins and ignores a repeated game id.
CREATE TABLE cpu_results (
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game        TEXT NOT NULL,
  game_id     TEXT NOT NULL,
  level       TEXT NOT NULL,
  result      TEXT NOT NULL,     -- 'win' | 'loss' | 'draw'
  points      INTEGER NOT NULL,  -- leaderboard points (only wins score; harder computers score more)
  duration_ms INTEGER NOT NULL,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (user_id, game_id)
);
CREATE INDEX cpu_results_board ON cpu_results(game, user_id);
