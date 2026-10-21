-- Mage Siege campaign progress: one JSON document per player
-- ({ cleared: { stage: stars }, endlessBest }). Unlocks are derived from it.
-- Runs themselves live in the MageRun Durable Object; Endless scores go to game_scores.
CREATE TABLE mage_progress (
  user_id    TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  data       TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
