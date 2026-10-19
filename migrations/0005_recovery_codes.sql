-- Password recovery without email: each account gets a one-time recovery
-- code (shown once, stored only as a PBKDF2 hash). Using it resets the
-- password and issues a new code.
ALTER TABLE users ADD COLUMN recovery_hash TEXT;
