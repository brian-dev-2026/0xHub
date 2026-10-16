-- 0xHub schema (Cloudflare D1 / SQLite)

CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  username      TEXT UNIQUE COLLATE NOCASE,      -- NULL for guests
  password_hash TEXT,                             -- NULL for guests
  is_guest      INTEGER NOT NULL DEFAULT 1,
  display_name  TEXT NOT NULL,
  avatar        TEXT NOT NULL,
  color         TEXT NOT NULL,
  rating        INTEGER NOT NULL DEFAULT 1000,
  wins          INTEGER NOT NULL DEFAULT 0,
  losses        INTEGER NOT NULL DEFAULT 0,
  draws         INTEGER NOT NULL DEFAULT 0,
  kos           INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL,
  last_seen_at  INTEGER NOT NULL
);
CREATE INDEX users_rating ON users(rating DESC) WHERE (wins + losses + draws) > 0;

CREATE TABLE sessions (
  token_hash  TEXT PRIMARY KEY,                   -- SHA-256 of the cookie token
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);

CREATE TABLE settings (
  user_id     TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  data        TEXT NOT NULL,                      -- JSON blob of client settings
  updated_at  INTEGER NOT NULL
);

CREATE TABLE endless_runs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  score        INTEGER NOT NULL,
  lines        INTEGER NOT NULL,
  level        INTEGER NOT NULL,
  duration_ms  INTEGER NOT NULL,
  created_at   INTEGER NOT NULL
);
CREATE INDEX endless_user_score ON endless_runs(user_id, score DESC);
CREATE INDEX endless_score ON endless_runs(score DESC);

CREATE TABLE battles (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  room         TEXT NOT NULL,
  player_a     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  player_b     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  winner       TEXT NOT NULL CHECK (winner IN ('a', 'b', 'draw')),
  reason       TEXT NOT NULL CHECK (reason IN ('time', 'forfeit')),
  a_kos        INTEGER NOT NULL,
  b_kos        INTEGER NOT NULL,
  a_sent       INTEGER NOT NULL,
  b_sent       INTEGER NOT NULL,
  a_lines      INTEGER NOT NULL,
  b_lines      INTEGER NOT NULL,
  a_delta      INTEGER NOT NULL,
  b_delta      INTEGER NOT NULL,
  duration_ms  INTEGER NOT NULL,
  created_at   INTEGER NOT NULL
);
CREATE INDEX battles_a ON battles(player_a, created_at DESC);
CREATE INDEX battles_b ON battles(player_b, created_at DESC);
