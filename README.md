# 0xHub

A modern gaming hub. First title: **Tetris Battle**, with an Endless mode and a real-time 1v1 Battle mode modeled on Facebook's Tetris Battle 2P.

## Stack

| Layer | Choice | Why |
| --- | --- | --- |
| Frontend | React 19, TypeScript, Vite, Tailwind CSS v4 | Fast dev loop, small bundle; the game renders on `<canvas>` |
| Realtime | WebSockets on Cloudflare Durable Objects | One Durable Object per match keeps both sockets and the match state in a single place |
| Database | Cloudflare D1 (managed SQLite) | Free tier, SQL console and backups in the dashboard; holds every account, setting, run and battle |
| Auth | Username + password (PBKDF2-SHA256) with HttpOnly session cookies, or guest | No third-party auth service needed |
| Hosting | Cloudflare Workers (static assets + API in one deploy) | Free plan covers it, and the site and game server deploy together |

**Why not Vercel:** Vercel serverless functions can't hold a WebSocket open, so a live 1v1 would need a paid third-party realtime service. Cloudflare runs the site, the WebSocket server and the database on one free account.

## Project layout

```
shared/protocol.ts        Message and API types shared by client and server
worker/index.ts           HTTP + WebSocket routing (/api/*)
worker/auth.ts            Password hashing + cookie sessions
worker/db.ts              All D1 queries: users, settings, runs, battles, leaderboards
worker/matchmaker.ts      Quick-match queue (Durable Object)
worker/room.ts            1v1 match referee: clock, garbage routing, KOs, results
migrations/               D1 schema (SQL migrations)
src/lib/auth.ts           Client session state: login, guest, profile, settings sync
src/games/tetris/engine.ts   Pure Tetris engine (unit tested)
src/games/tetris/render.ts   Canvas renderer + block skins
src/games/tetris/skins.ts    Skin and board-theme definitions
src/games/tetris/session.ts  Game loop, input, effects
src/pages/*               Dashboard, Games, Tetris, Endless, Battle, Leaderboard, Profile, Settings
```

## Accounts and data

Nothing is stored in the browser except the session cookie. Everything else is in D1:

| Table | Holds |
| --- | --- |
| `users` | Accounts and guests: display name, avatar, color, battle rating and W/L/D/KO counters |
| `sessions` | Login sessions (only a SHA-256 of the token is stored), 30-day sliding expiry |
| `settings` | Per-user skin, theme, key bindings, handling and audio settings |
| `endless_runs` | Every endless run (score, lines, level, duration) |
| `battles` | Every finished 1v1: players, winner, KOs, lines sent and cleared, rating changes |

- **Play as guest** creates a real guest user on the server, so its progress is saved. A guest can create an account from Profile, which upgrades the same user and keeps all stats.
- **Multiplayer identity** comes from the session cookie on the server. Clients only send their skin, so names and ratings can't be spoofed.
- Battle results are written by the server (the match referee), not by clients.

## Tetris mechanics

- SRS rotation with full wall-kick tables, 7-bag randomizer, hold (once per piece), 5-piece next queue, ghost piece
- Lock delay of 500 ms with move reset (15 resets max)
- T-spin detection (3-corner rule, including minis), back-to-back, combos, perfect clears
- Configurable DAS, ARR and soft-drop speed; key remapping

**Battle 2P rules (Tetris Battle style)**

- 2-minute rounds. Topping out gives your opponent a KO and your field resets. Most KOs wins; ties go to whoever sent more lines.
- Garbage sent: Double 1, Triple 2, Tetris 4, T-Spin Single/Double/Triple 2/4/6, Back-to-Back +1, Combo +1…+5, Perfect Clear +10
- Incoming garbage shows on the red meter. Your line clears cancel it first; anything left rises when you lock a piece without clearing.
- Your opponent's board streams live (about 20 updates/sec) and renders in their chosen skin.
- Quick match, or a private room with a 5-character code and a share link
- Elo rating (starts at 1000) and a global battle leaderboard

**Customization:** 10 block skins (Classic bevel, Flat, Neon, Glass, 8-Bit, Candy, Gems, Wireframe, Monochrome, Sunset) and 8 board themes (Tetris Battle, Midnight, Aurora, Synthwave, Matrix, Ember, Void, Paper), with a live preview. Choices are saved to your account.

## Develop

```bash
npm install
npm run dev        # applies migrations to a local D1, then serves http://localhost:5173
npm test           # engine unit tests
npm run typecheck
```

To test 1v1 locally, open a normal window and a private window (two separate sessions). Sign in or play as guest in each, then hit **Quick match** in both.

## Deploy to Cloudflare (free)

1. Log in from this folder (opens your browser once):
   ```bash
   npx wrangler login
   ```
2. Deploy:
   ```bash
   npm run deploy
   ```
   This builds the app, applies any new D1 migrations to the remote database (the `database_id` in `wrangler.jsonc`), then deploys. It prints your URL, e.g. `https://0xhub.<your-subdomain>.workers.dev`.
3. Optional: add a custom domain under Workers & Pages → 0xhub → Settings → Domains & Routes.

For automatic deploys on every push, connect the GitHub repo under Workers & Pages → 0xhub → Settings → Builds. Use build command `npm run build` and deploy command `npx wrangler d1 migrations apply DB --remote && npx wrangler deploy`.

To look at the data, open the Cloudflare dashboard → Storage & Databases → D1 → your database → Console, or run:

```bash
npx wrangler d1 execute DB --remote --command "SELECT display_name, rating FROM users ORDER BY rating DESC LIMIT 10"
```

## Known limits / next steps

- No password reset yet (accounts have no email). Adding email, or Google/GitHub sign-in, would allow recovery.
- Login has no rate limiting yet. Cloudflare's Rate Limiting binding or a Turnstile check would harden it.
- Guest users that never come back stay in the `users` table. A scheduled cleanup (Cron Trigger) can prune old, empty guests.
- Each client simulates its own board, and the server referees time, garbage and KOs. Endless scores get plausibility checks, not full server-side replay validation.
- Switching browser tabs mid-battle pauses your board (browsers throttle background animation), but the match clock keeps running.
