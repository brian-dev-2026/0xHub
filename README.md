# 0xHub

A modern gaming hub with seven games. Every result is decided or verified by the server.

| Game | Modes | Fairness model |
| --- | --- | --- |
| **Tetris Battle** | Endless (verified high score) · 1v1 Battle (2-minute KO rounds, modeled on the Facebook Tetris Battle 2P) | Deterministic engine; the server replays inputs |
| **Snake Arena** | 2–4 player free-for-all (2-minute rounds) · quick match · private rooms · practice vs bots | Server runs the whole simulation at 10 ticks/s; clients send only direction changes |
| **2048 Duel** | Solo (verified high score) · 1v1 race to 2048 (5-minute cap, same tiles for both) | The server holds the RNG and places every new tile; clients only slide |
| **Minesweeper Rush** | Time attack: Beginner, Intermediate, Expert | Mine layout never leaves the server; the server reveals cells and times the run |
| **Connect Four** | 1v1 with a 30-second turn clock, rematches alternate who starts | Fully server-authoritative; clients send only "drop in column c" |
| **Chess** | Rated 1v1 with time controls (1+0, 3+2, 5+0, 10+0, 15+10) · vs computer (4 levels) | Server validates every move and runs the clocks |
| **Game of the Generals** | Rated 1v1 with a secret 3-minute setup, 10 min + 5 s per move · vs computer | Server is the arbiter: it holds both armies and never reveals enemy ranks |

All five have quick match and/or private rooms where relevant, global leaderboards, Elo ratings for the 1v1 modes, and stats and history on the dashboard and profile. The Tetris display name is one constant: `GAME_NAME` in `src/games/registry.ts`.

The UI uses no emoji or image assets: avatars (tetromino/pentomino shapes in the player's color), game logos, medals and marks are all drawn with CSS, and icons are inline SVG.

## Stack

| Layer | Choice | Why |
| --- | --- | --- |
| Frontend | React 19, TypeScript, Vite, Tailwind CSS v4 | Fast dev loop, small bundle; the game renders on `<canvas>` |
| Realtime | WebSockets on Cloudflare Durable Objects (hibernation API) | One Durable Object per match is the authoritative referee |
| Database | Cloudflare D1 (managed SQLite) | Accounts, sessions, settings, runs, battles, rate limits |
| Auth | Username + password (PBKDF2-SHA256), HttpOnly cookie sessions, or guest; one-time recovery codes for forgotten passwords | No third-party auth or email service needed |
| Hosting | Cloudflare Workers (static assets + API in one deploy) | Free plan covers it, and the site and game server deploy together |

**Why not Vercel:** Vercel serverless functions can't hold a WebSocket open, so a live 1v1 would need a paid third-party realtime service.

## How fair play works

The browser never reports results. It only sends **inputs**, and the server replays them:

- `shared/tetris/` holds a deterministic engine that runs in both the browser and the Worker. It uses fixed 1/60-second steps, a seeded RNG, and no `Math.random`, `Math.pow` or clock reads. The same seed plus the same inputs at the same steps always produce the same game.
- **Battle:** each match is a `BattleRoom` Durable Object. Clients send batches of `[step, input]` events about 20 times a second, with a hash of their state. The room replays them on its own copy of each game, then:
  - computes every attack, garbage line and KO itself;
  - routes garbage to the opponent, who must apply it within 2 seconds or the server applies it for them;
  - resyncs a client whose hash doesn't match;
  - runs forward a client that falls more than 3 seconds behind real time, so stalling gains nothing;
  - rejects clients that claim to be ahead of real time.
- **Endless:** the server issues the seed (`EndlessRun` Durable Object). The client streams inputs every 5 seconds, and the server replays them and records **its own** score. Runs that are ahead of real time, malformed, or don't match are rejected.
- **Snake Arena** (`SnakeRoom`): the simulation only exists on the server. Clients send direction changes and render the snapshot broadcast every tick (interpolated for smoothness). Bots are server-side.
- **2048** (`Run2048`, `Duel2048Room`): the RNG never leaves the server, so upcoming tiles can't be predicted. The browser slides tiles instantly and sends the move (with a state hash); the server replies with the tile that spawned. Moves pressed while a reply is in flight are queued. In duels both boards start from the same seed, and the opponent's board streams live.
- **Minesweeper Rush** (`MinesRun`): mines are placed on the server after your first click (never on or next to it). Each click returns only the newly revealed cells, so the layout can't be read from the page. The official time runs from your first click reaching the server to your winning click reaching the server.
- **Connect Four** (`Connect4Room`): the server owns the board, the turn and the 30-second clock.
- **Chess** (`ChessRoom`, rules in `shared/games/chess.ts`): full FIDE rules — castling, en passant, promotion, check/mate/stalemate; insufficient material, fivefold repetition and the 75-move rule end the game automatically; threefold repetition and the 50-move rule are claimable; draw offers; flag fall loses unless the opponent can't possibly mate (then it's a draw). Fischer increment; clocks start after each side's first move, and a game with no first move within 30 s is aborted (unrated). The move generator is verified with standard perft counts.
- **Game of the Generals** (`GeneralsRoom`, rules in `shared/games/generals.ts`): official Salpakan rules — 21 pieces, secret setup in your first three rows, one-square orthogonal moves, the arbiter's challenge table (Spy beats officers, Private beats Spy, attacking Flag beats Flag), and the flag win (reaching the far row; if it lands next to an enemy it must survive one more turn). Each player only ever receives their own ranks; after a challenge they learn which piece was eliminated, never the enemy's rank. Everything is revealed when the game ends.
- The computer opponents for both run in the browser and are unrated practice.
- What this does **not** stop: a bot that plays well using legitimate inputs. Verification proves a game was played by the rules, not by a human.

## Reliability

- **Reconnect:** if a battle connection drops, the client reconnects automatically. The seat is held for 15 seconds and the player resumes from the server's state. Leaving on purpose forfeits immediately.
- **Deploys and restarts:** match state is persisted in Durable Object storage every few seconds and on key events, and the round clock uses Durable Object alarms. A restart costs at most a few seconds of rollback, not the match.
- **Background tabs:** the game keeps running even when the browser throttles animation in a background tab.
- **Two tabs:** opening the same match in another tab takes over the seat. Every connection carries an increasing sequence number, so a stale, abandoned connection attempt that reaches the server late can't kick out the live one. The matchmaker never pairs you with yourself.
- **Snake** rounds are saved every 2 seconds. If the room's server restarts mid-round (a deploy, a crash), the round resumes from the last save when players reconnect, and the round clock is paused for the downtime.
- Abandoned solo runs (no input for an hour) are deleted by a Durable Object alarm.

## Security

- **Forgot password:** accounts have no email, so each account gets a **recovery code** (20 characters, about 98 bits) when it's created. It's shown once with copy and download buttons, and only its PBKDF2 hash is stored. Username + code + new password resets the password, signs out every other session and issues a fresh code; the old one stops working. A new code can be created from the profile (password required). Attempts are limited to 10 per IP and 5 per account per hour.
- Passwords are hashed with PBKDF2-SHA256 (100k iterations, per-user salt) and compared in constant time. Sessions are random 256-bit tokens; only their SHA-256 is stored. Cookies are `HttpOnly; SameSite=Lax; Secure` (on HTTPS), with a 30-day sliding expiry. Changing your password signs out your other devices.
- Rate limits are stored in D1:
  - sign-in: 30 per IP per 10 minutes, and 10 per account per 15 minutes
  - sign-up: 10 per IP per hour
  - guest creation: 30 per IP per hour
  - starting endless runs: 120 per account per hour
- State-changing requests are checked for a same-origin `Origin` header. Request bodies are size-limited, and WebSocket messages are limited in size (64 KB) and rate (120 per second).
- Security headers (`public/_headers`): a strict CSP, `X-Frame-Options: DENY`, `nosniff`, HSTS, and Referrer and Permissions policies.
- Account deletion removes your profile, settings, sessions and runs. Battles stay in opponents' history under "Deleted player".
- A nightly cron cleans up expired sessions, old rate-limit rows, and guests inactive for 30 days who never finished a game.

## Data (D1)

| Table | Holds |
| --- | --- |
| `users` | Accounts and guests: display name, avatar, color, rating, W/L/D/KO counters, recovery code hash |
| `sessions` | Session token hashes with expiry |
| `settings` | Per-user skin, theme, keys, handling, audio |
| `endless_runs` | Every verified endless run |
| `battles` | Every finished 1v1: players, winner, KOs, lines, rating changes |
| `rate_limits` | Fixed-window counters |
| `game_scores` | Verified solo results: 2048 scores, Minesweeper times (lower is better), Snake round scores |
| `game_matches`, `game_match_players` | Finished Snake, 2048 Duel and Connect Four matches, per player: place, score, rating change |
| `game_ratings` | Per-game Elo and win/loss/draw record |

Nothing is stored in the browser except the session cookie.

## Game rules

- SRS rotation with full wall kicks, 7-bag, hold (once per piece), 5-piece preview, ghost piece
- 500 ms lock delay with move reset (15 resets max)
- T-spins (3-corner rule, including minis), back-to-back, combos, perfect clears
- Battle: 2-minute rounds. Topping out gives your opponent a KO and your field resets. Most KOs wins; ties go to whoever sent more lines.
- Garbage sent: Double 1, Triple 2, Tetris 4, T-Spin Single/Double/Triple 2/4/6, Back-to-Back +1, Combo +1…+5, Perfect Clear +10. Your clears cancel incoming garbage first.
- Customization: 10 block skins and 8 board themes, saved to your account.

## Looks (all games)

Every game has cosmetic options, picked in **Settings → Look** or in the **Customize** section of each game's page, and saved to your account. Definitions are in `src/games/looks.ts`.

| Game | Options |
| --- | --- |
| Tetris | 10 block skins, 8 board themes, ghost piece on/off |
| Snake Arena | 6 snake styles (Classic, 8-Bit, Neon, Candy, Scales, Wireframe) · 7 arenas. Snakes keep their player colors in every style. |
| 2048 | 8 tile sets (Classic, Midnight, Neon, Pastel, Ocean, Ember, Monochrome, 8-Bit) |
| Minesweeper | 6 board themes (Modern, Classic, Neon, Paper, Forest, Ocean) |
| Connect Four | 6 disc sets · 6 boards. Your opponent sees the board in their own look. |
| Chess | 6 boards (Wood, Tournament, Ice, Slate, Synthwave, Marble) · 5 piece sets |
| Game of the Generals | 4 piece sets · 4 boards. Pieces show the rank insignia (stars, suns, triangles, chevrons). |

## Project layout

```
shared/protocol.ts           Message + API types shared by client and server
shared/tetris/engine.ts      Deterministic engine (unit tested)
shared/tetris/sim.ts         Fixed-step player simulation, input codes, replay helpers
worker/index.ts              HTTP routes, auth, rate limits, cron
worker/room.ts               BattleRoom: authoritative 1v1 referee
worker/endless.ts            EndlessRun: incremental run verification
worker/matchmaker.ts         Quick-match queues (pairs for 1v1; groups of up to 4 for Snake)
worker/games/                SnakeRoom, Duel2048Room, Connect4Room (on a shared BaseRoom), MinesRun, Run2048
worker/gamesDb.ts            D1 queries for the other games
worker/storage.ts            Clearing a Durable Object's storage (safe inside alarms)
shared/games/                Rules for Snake, 2048, Minesweeper, Connect Four (unit tested)
worker/db.ts, worker/auth.ts D1 queries; password hashing + sessions
migrations/                  D1 schema
src/games/tetris/            Client session, input, renderer, skins, battle client
src/pages/                   Hub pages + Tetris pages
src/pages/games/             Snake, 2048, Minesweeper, Connect Four
```

## Develop

```bash
npm install
npm run dev        # applies migrations to a local D1, then serves http://localhost:5173
npm test           # engine, determinism and session replay tests
npm run typecheck
```

To test 1v1 locally, open a normal window and a private window, sign in (or play as guest) in each, and press **Quick match** in both.

CI (`.github/workflows/ci.yml`) runs the typecheck, tests and build on every push to `main` and on every pull request.

## Deploy to Cloudflare (free)

```bash
npx wrangler login     # once; opens your browser
npm run deploy         # build → apply D1 migrations (remote) → deploy
```

It prints your URL, e.g. `https://0xhub.<your-subdomain>.workers.dev`. You can add a custom domain under Workers & Pages → 0xhub → Settings → Domains & Routes.

For automatic deploys from GitHub, connect the repo under Workers & Pages → 0xhub → Settings → Builds. Use build command `npm run build` and deploy command `npx wrangler d1 migrations apply DB --remote && npx wrangler deploy`.

To inspect data, open Cloudflare dashboard → Storage & Databases → D1 → Console, or run:

```bash
npx wrangler d1 execute DB --remote --command "SELECT display_name, rating FROM users ORDER BY rating DESC LIMIT 10"
```

## Known limits

- **Tested:** Chrome, Firefox and WebKit (Safari's engine) on desktop, an emulated iPhone (touch controls, phone layout), and all games through a proxy adding 150 ms of round-trip lag with jitter. **Not yet tested:** real phones and the real Safari app, and real internet between two locations. Do a short playtest on your own devices before a public launch.
- Bots that play using legitimate inputs can't be detected by replay verification.
- A lost recovery code plus a forgotten password can't be recovered (there's no email). Google sign-in, or email via Resend once you have a domain, would add another way back.
- 2048 moves wait for the server's tile, so each move takes one round trip; up to 3 key presses are queued meanwhile, so fast play still feels responsive.
- Free-tier capacity: D1 and Durable Object storage each allow about 100k row writes per day. A battle writes roughly 50–100 rows, so this covers several hundred matches a day before needing the $5/month Workers Paid plan.
