-- Avatars switch from emoji to CSS block shapes (see shared/avatars.ts).
UPDATE users SET avatar = CASE avatar
  WHEN '🎮' THEN 't-T'
  WHEN '🚀' THEN 't-I'
  WHEN '🐼' THEN 't-O'
  WHEN '🦊' THEN 't-S'
  WHEN '🐉' THEN 't-Z'
  WHEN '🤖' THEN 't-J'
  WHEN '🍀' THEN 't-L'
  WHEN '👾' THEN 'p-X'
  WHEN '🌙' THEN 'p-U'
  WHEN '💎' THEN 'p-V'
  WHEN '🔥' THEN 'p-W'
  WHEN '🦄' THEN 'p-F'
  WHEN '🎯' THEN 'p-P'
  WHEN '⚡' THEN 'p-N'
  WHEN '🐙' THEN 'p-Y'
  WHEN '👑' THEN 'p-L'
  WHEN '👤' THEN 'none'
  ELSE 't-T'
END
WHERE avatar NOT LIKE 't-%' AND avatar NOT LIKE 'p-%' AND avatar != 'none';
