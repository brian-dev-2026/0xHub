-- Fixed-window counters for login / signup / guest throttling.
CREATE TABLE rate_limits (
  key       TEXT PRIMARY KEY,   -- e.g. "login-ip:1.2.3.4", "login-user:alice"
  count     INTEGER NOT NULL,
  reset_at  INTEGER NOT NULL
);
CREATE INDEX rate_limits_reset ON rate_limits(reset_at);

CREATE INDEX users_guest_seen ON users(last_seen_at) WHERE is_guest = 1;
CREATE INDEX sessions_expiry ON sessions(expires_at);
